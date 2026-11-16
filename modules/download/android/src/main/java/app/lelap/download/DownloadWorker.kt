package app.lelap.download

import android.app.NotificationChannel
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
import java.io.File
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

    try {
      setForeground(foregroundInfo(job, 0L, total))
    } catch (e: IllegalStateException) {
      // Android 12+ refuses a foreground start from the background without the battery
      // exemption. The work still runs as a normal job, and a stopped run resumes its part file.
    }

    return withContext(Dispatchers.IO) {
      try {
        var finished = 0L
        var lastReport = 0L
        for (file in job.files) {
          val target = File(dir, file.name)
          if (target.isFile) {
            finished += target.length()
            continue
          }
          Http.fetch(file.url, target, file.size) { bytes ->
            val now = SystemClock.elapsedRealtime()
            if (now - lastReport >= PROGRESS_INTERVAL_MS) {
              lastReport = now
              report(job, finished + bytes, total)
            }
          }
          finished += target.length()
        }
        job.cover?.let { cover ->
          val target = File(dir, cover.name)
          // The cover is a nicety; the book plays without it.
          if (!target.isFile) runCatching { Http.fetch(cover.url, target, cover.size) {} }
        }
        Downloads.clearError(dir)
        Result.success()
      } catch (e: CancellationException) {
        throw e
      } catch (e: PermanentFailure) {
        Downloads.writeError(dir, e.message ?: "The download failed.")
        Result.failure()
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
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val percent = if (total > 0) (done * 100 / total).toInt().coerceIn(0, 100) else 0
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle(job.title)
      .setContentText("Downloading")
      .setProgress(100, percent, total <= 0)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setContentIntent(open)
      .addAction(0, "Cancel", WorkManager.getInstance(context).createCancelPendingIntent(id))
      .build()
    val notificationId = job.bookId.hashCode()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(notificationId, notification)
    }
  }
}
