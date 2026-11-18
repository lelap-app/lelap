package app.lelap.download

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.lelap.netfs.Messages
import app.lelap.netfs.NetLogin
import app.lelap.netfs.Netfs
import app.lelap.text.NativeText
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val CHANNEL_ID = "downloads"
private const val PROGRESS_INTERVAL_MS = 1_000L
// Network errors retry with backoff; after this many runs the download is marked failed.
private const val MAX_ATTEMPTS = 12

/** Downloads one book's missing parts in order, then its cover. */
class DownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  companion object {
    const val KEY_BOOK_ID = "bookId"
  }

  override suspend fun doWork(): Result {
    val bookId = inputData.getString(KEY_BOOK_ID) ?: return Result.failure()
    val dir = Downloads.bookDir(applicationContext, bookId)
    val job = Downloads.readJob(dir) ?: return Result.failure()
    val total = job.files.sumOf { it.size }
    val place = Downloads.place(applicationContext, job.location)
    if (!withContext(Dispatchers.IO) { place.available() }) {
      Downloads.writeError(dir, NativeText.t(applicationContext, "The download folder can’t be reached. Put the SD card back, or choose another folder in Settings."))
      return Result.failure()
    }

    try {
      setForeground(foregroundInfo(job, 0L, total))
    } catch (e: IllegalStateException) {
      // Android 12+ refuses a foreground start from the background without the battery
      // exemption. The work still runs as a normal job, and a stopped run resumes its part file.
    }

    return withContext(Dispatchers.IO) {
      try {
        val folder = place.folder(job.bookId, create = true) ?: throw IOException("No folder for the book.")
        var finished = 0L
        var lastReport = 0L
        for (file in job.files) {
          val existing = folder.length(file.name)
          if (existing != null) {
            finished += existing
            continue
          }
          val progress: suspend (Long) -> Unit = { bytes ->
            val now = SystemClock.elapsedRealtime()
            if (now - lastReport >= PROGRESS_INTERVAL_MS) {
              lastReport = now
              report(job, finished + bytes, total)
            }
          }
          if (Netfs.handles(file.url)) {
            NetDownload.fetch(file.url, folder, file.name, file.size, job.headers, { Messages.describe(applicationContext, it) }, progress)
          } else {
            Http.fetch(file.url, folder, file.name, file.size, job.headers, progress)
          }
          finished += folder.length(file.name) ?: 0L
        }
        job.cover?.let { cover ->
          // The cover is a nicety; the book plays without it.
          if (folder.length(cover.name) == null) {
            runCatching {
              if (Netfs.handles(cover.url)) {
                NetDownload.fetch(cover.url, folder, cover.name, cover.size, job.headers, { it.message.orEmpty() }) {}
              } else {
                // An SMB or SFTP login never goes to a web host.
                Http.fetch(cover.url, folder, cover.name, cover.size, job.headers.filterKeys { !it.equals(NetLogin.HEADER, ignoreCase = true) }) {}
              }
            }
          }
        }
        Downloads.clearError(dir)
        // The listener chose another folder while this book was downloading: move it there now.
        if (job.location != Downloads.location(applicationContext)) Mover.start(applicationContext, delaySeconds = 5)
        Result.success()
      } catch (e: CancellationException) {
        throw e
      } catch (e: PermanentFailure) {
        Downloads.writeError(dir, e.message ?: "The download failed.")
        Result.failure()
      } catch (e: RuntimeException) {
        // The Storage Access Framework throws these when a card goes or a permission is withdrawn.
        if (e is CancellationException) throw e
        if (runAttemptCount + 1 >= MAX_ATTEMPTS) {
          Downloads.writeError(dir, "The download kept failing: ${e.message ?: "storage error"}")
          Result.failure()
        } else {
          Result.retry()
        }
      } catch (e: IOException) {
        if (runAttemptCount + 1 >= MAX_ATTEMPTS) {
          Downloads.writeError(dir, "The download kept failing: ${e.message ?: "network error"}")
          Result.failure()
        } else {
          Result.retry()
        }
      }
    }
  }

  private suspend fun report(job: DownloadJob, done: Long, total: Long) {
    setProgress(workDataOf("bytesDone" to done))
    runCatching { setForeground(foregroundInfo(job, done, total)) }
  }

  private fun foregroundInfo(job: DownloadJob, done: Long, total: Long): ForegroundInfo {
    val context = applicationContext
    NativeText.channel(context, CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW)
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val percent = if (total > 0) (done * 100 / total).toInt().coerceIn(0, 100) else 0
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(job.title)
      .setContentText(NativeText.t(context, "Downloading"))
      .setProgress(100, percent, total <= 0)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setContentIntent(open)
      .addAction(0, NativeText.t(context, "Cancel"), WorkManager.getInstance(context).createCancelPendingIntent(id))
      .build()
    val notificationId = job.bookId.hashCode()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(notificationId, notification)
    }
  }
}
