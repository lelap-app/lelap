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
import java.io.File
import java.io.IOException
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

  /** Starts a move, or queues one after a move already running, which may have passed a book. */
  fun start(context: Context) {
    val request = OneTimeWorkRequestBuilder<MoveWorker>()
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
  }

  /** Picks up a move that stopped or waited for an SD card; nothing when every book is in place. */
  fun resume(context: Context) {
    if (!isMoving(context) && waiting(context) > 0) start(context)
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
    runCatching { setForeground(foregroundInfo(0, Mover.waiting(context))) }
    return withContext(Dispatchers.IO) {
      Mover.setError(context, null)
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
      } catch (e: IOException) {
        // The files that were not copied stay where they were; nothing is deleted before its copy is checked.
        Mover.setError(context, NativeText.t(context, "Moving downloads stopped: {reason}", "reason" to (e.message ?: "")))
        Result.failure()
      }
    }
  }

  private suspend fun moveBook(job: DownloadJob, from: Place, to: Place) {
    val context = applicationContext
    val source = from.folder(job.bookId, create = false)
    val bytes = source?.list()?.values?.sum() ?: 0L
    val space = to.space()
    if (source != null && space != null && space.first < bytes) {
      throw IOException(NativeText.t(context, "There is not enough space in the new folder."))
    }
    val target = to.uri
    val commit = {
      synchronized(Downloads.lock) {
        val dir = Downloads.bookDir(context, job.bookId)
        val current = Downloads.readJob(dir)
        val work = Downloads.workState(context, job.bookId)
        // Gone, or started again meanwhile: leave it where it was.
        if (current == null || !LocationRules.shouldMove(current.location, target, work)) {
          false
        } else {
          Downloads.writeJob(dir, current.copy(location = target))
          true
        }
      }
    }
    if (source == null) {
      // Nothing on disk yet: the book only needs to point at the new folder.
      commit()
      return
    }
    val folder = to.folder(job.bookId, create = true) ?: throw IOException("No folder for the book.")
    var lastReport = 0L
    val worker = this
    val done = BookMove.move(
      from = source,
      to = folder,
      commit = commit,
      checkStopped = { if (worker.isStopped) throw CancellationException("Stopped") },
      onBytes = { copied ->
        val now = SystemClock.elapsedRealtime()
        if (now - lastReport >= PROGRESS_INTERVAL_MS) {
          lastReport = now
          runBlocking { setProgress(workDataOf("bookId" to job.bookId, "bytesDone" to copied, "bytesTotal" to bytes)) }
        }
      },
    )
    if (done) from.removeFolder(job.bookId) else to.removeFolder(job.bookId)
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
