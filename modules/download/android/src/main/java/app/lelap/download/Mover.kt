package app.lelap.download

import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.lelap.text.NativeText
import app.lelap.text.Reasons
import app.lelap.text.ShownException
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

private const val WORK_NAME = "download-move"
private const val CHANNEL_ID = "downloads"
private const val NOTIFICATION_ID = 0x4d4f5645
private const val PROGRESS_INTERVAL_MS = 1_000L

/** Moves downloaded books to the folder the listener chose, one book at a time. */
object Mover {
  private const val ERROR_FILE = "move-error.txt"

  /**
   * Starts a move, or queues one after a move already running, which may have passed a book.
   * [delaySeconds] lets a download that asks for the move finish first, so it is not skipped.
   */
  fun start(context: Context, delaySeconds: Long = 0) {
    val request = OneTimeWorkRequestBuilder<MoveWorker>()
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
  }

  /** Picks up a move that stopped or waited for an SD card; nothing when every book is in place. */
  fun resume(context: Context) {
    if (isMoving(context)) return
    if (waiting(context) > 0 || Downloads.bookDirs(context).any { Downloads.moving(it) != null }) start(context)
  }

  /**
   * Deletes the half copies a crash left mid-copy. Their folder may never be chosen again, so the
   * next move would not replace them. Only [MoveWorker] calls it, before it copies anything: it is
   * unique work, so no copy can be under way.
   */
  internal fun clearLeftovers(context: Context) {
    for (dir in Downloads.bookDirs(context)) {
      synchronized(Downloads.lock) {
        val target = (Downloads.moving(dir) ?: return@synchronized).ifEmpty { null }
        val current = Downloads.readJob(dir)?.location
        val place = Downloads.place(context, target)
        runCatching {
          // An SD card that is out keeps the note until it is back.
          if (!place.available()) return@runCatching
          val folder = place.folder(dir.name, create = false)
          if (folder != null && BookMove.clearLeftovers(folder) && target != null && target != current) {
            place.removeFolder(dir.name)
          }
          Downloads.clearMoving(dir)
        }
      }
    }
  }

  fun isMoving(context: Context): Boolean =
    WorkManager.getInstance(context).getWorkInfosForUniqueWork(WORK_NAME).get()
      .any { it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED }

  fun error(context: Context): String? = File(Downloads.root(context), ERROR_FILE).takeIf { it.isFile }?.readText()

  fun setError(context: Context, message: String?) {
    val file = File(Downloads.root(context), ERROR_FILE)
    if (message == null) file.delete() else file.writeText(message)
  }

  /** Books whose files are not in the current folder yet. */
  fun waiting(context: Context): Int {
    val target = Downloads.location(context)
    return Downloads.bookDirs(context).count { Downloads.readJob(it)?.let { job -> job.location != target } == true }
  }
}

class MoveWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val context = applicationContext
    // Loads the profile's lines for code without a Context, such as the folders' errors.
    NativeText.get(context)
    runCatching { setForeground(foregroundInfo(0, Mover.waiting(context))) }
    return withContext(Dispatchers.IO) {
      Mover.setError(context, null)
      Mover.clearLeftovers(context)
      val dirs = Downloads.bookDirs(context)
      var moved = 0
      try {
        for (dir in dirs) {
          coroutineContext.ensureActive()
          val job = Downloads.readJob(dir) ?: continue
          // Read again for every book: the listener may choose yet another folder meanwhile.
          val target = Downloads.location(context)
          if (!LocationRules.shouldMove(job.location, target, Downloads.workState(context, job.bookId))) continue
          val from = Downloads.place(context, job.location)
          val to = Downloads.place(context, target)
          if (!from.available() || !to.available()) {
            // An SD card that is out: its books stay where they are and move once it is back.
            Mover.setError(context, NativeText.t(context, "Some downloads stay where they are until their folder can be reached again."))
            continue
          }
          moveBook(job, from, to)
          moved++
          runCatching { setForeground(foregroundInfo(moved, moved + Mover.waiting(context))) }
        }
        Result.success()
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        // IOException, and the runtime exceptions the Storage Access Framework throws when a card
        // goes mid-call. Every book keeps its files where its job says; originals are only ever
        // deleted after the job points at their copies.
        val reason = Reasons.of(e, NativeText.get(context))
        Mover.setError(
          context,
          reason?.let { NativeText.t(context, "Moving downloads stopped: {reason}", "reason" to it) }
            ?: NativeText.t(context, "Moving downloads stopped."),
        )
        // A failed result would fail the moves queued behind this one; the error is kept above.
        Result.success()
      }
    }
  }

  private fun moveBook(job: DownloadJob, from: Place, to: Place) {
    val context = applicationContext
    val dir = Downloads.bookDir(context, job.bookId)
    val target = to.uri
    synchronized(Downloads.lock) {
      // Copies an earlier move left in the target are about to be reused, or replaced: they are
      // no longer old, and must not be deleted under the copy.
      Downloads.writeOld(dir, Downloads.readOld(dir).filter { it.location != target })
    }
    val source = from.folder(job.bookId, create = false)
    val bytes = source?.list()?.values?.sum() ?: 0L
    val space = to.space()
    if (source != null && space != null && space.first < bytes) {
      throw ShownException(NativeText.t(context, "There is not enough space in the new folder."))
    }
    val folder = if (source == null) null else to.folder(job.bookId, create = true) ?: throw ShownException(NativeText.t(context, "Could not make the book’s folder in the download folder."))
    var lastReport = 0L
    val worker = this
    val names = if (source == null || folder == null) {
      emptyList()
    } else {
      Downloads.markMoving(dir, target)
      try {
        BookMove.copy(
          from = source,
          to = folder,
          checkStopped = { if (worker.isStopped) throw CancellationException("Stopped") },
          onBytes = { copied ->
            val now = SystemClock.elapsedRealtime()
            if (now - lastReport >= PROGRESS_INTERVAL_MS) {
              lastReport = now
              runBlocking { setProgress(workDataOf("bookId" to job.bookId, "bytesDone" to copied, "bytesTotal" to bytes)) }
            }
          },
        ).also { Downloads.clearMoving(dir) }
      } catch (e: Exception) {
        // A full card: its half copy goes now. A stop or a card taken out keeps the note for later.
        if (e !is CancellationException) {
          runCatching {
            if (BookMove.clearLeftovers(folder) && target != null) to.removeFolder(job.bookId)
            Downloads.clearMoving(dir)
          }
        }
        throw e
      }
    }
    synchronized(Downloads.lock) {
      val current = Downloads.readJob(dir)
      val unchanged = current != null &&
        current.revision == job.revision &&
        current.location == job.location &&
        LocationRules.shouldMove(current.location, target, Downloads.workState(context, job.bookId))
      if (unchanged && current != null) {
        // The originals go on the list first, so a crash right after never loses track of them.
        // They are deleted once the app has moved the player to the new files (releaseOld).
        Downloads.writeOld(dir, Downloads.readOld(dir) + OldCopy(job.location, names))
        Downloads.writeJob(dir, current.copy(location = target))
        return
      }
      // Removed, started again or moved meanwhile. The copies go, unless the book lives in the
      // target now, where they may be its files.
      if (current?.location != target && folder != null) {
        names.forEach(folder::delete)
        if (target != null && folder.list().isEmpty()) to.removeFolder(job.bookId)
      }
    }
  }

  private fun foregroundInfo(done: Int, total: Int): ForegroundInfo {
    val context = applicationContext
    NativeText.channel(context, CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(NativeText.t(context, "Moving downloads"))
      .setProgress(total.coerceAtLeast(1), done, total <= 0)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .build()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(NOTIFICATION_ID, notification)
    }
  }
}
