package app.lelap.library

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Scans for chapters from silences (M45). Each book has a folder with `job.json`, `progress.json`
 * and, once finished, `result.json` (or `error.txt`), which JavaScript reads and then removes.
 */
object Silences {
  private const val TAG = "lelap-silences"
  private const val JOB = "job.json"
  private const val PROGRESS = "progress.json"
  private const val RESULT = "result.json"
  private const val ERROR = "error.txt"

  fun root(context: Context) = File(context.noBackupFilesDir, "silences")

  fun dir(context: Context, bookId: String) = File(root(context), bookId)

  private fun workName(bookId: String) = "silences:$bookId"

  fun readJob(dir: File): SilenceJob? = File(dir, JOB).takeIf { it.isFile }?.readText()?.let(SilenceJob::decode)

  fun readProgress(dir: File) = SilenceProgress.decode(File(dir, PROGRESS).takeIf { it.isFile }?.readText())

  fun writeProgress(dir: File, progress: SilenceProgress) = writeAtomically(File(dir, PROGRESS), progress.encode())

  fun writeResult(dir: File, progress: SilenceProgress) =
    writeAtomically(File(dir, RESULT), SilenceProgress.encodeResult(progress))

  fun writeError(dir: File, message: String) = File(dir, ERROR).writeText(message)

  private fun writeAtomically(target: File, text: String) {
    val tmp = File(target.parentFile, "${target.name}.tmp")
    tmp.writeText(text)
    tmp.renameTo(target)
  }

  fun enqueue(context: Context, job: SilenceJob) {
    val dir = dir(context, job.bookId)
    dir.deleteRecursively()
    dir.mkdirs()
    writeAtomically(File(dir, JOB), job.encode())
    // Decoding a long book takes a while and a good part of a battery; it waits for enough charge
    // and stops when the battery runs low, then goes on from its last checkpoint.
    val constraints = Constraints.Builder().setRequiresBatteryNotLow(true).build()
    val request = OneTimeWorkRequestBuilder<SilenceWorker>()
      .setConstraints(constraints)
      .setInputData(workDataOf(SilenceWorker.KEY_BOOK_ID to job.bookId))
      .addTag(TAG)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(workName(job.bookId), ExistingWorkPolicy.REPLACE, request)
  }

  /** Stops a scan and forgets it, or forgets a finished one after JavaScript stored its chapters. */
  fun remove(context: Context, bookId: String) {
    WorkManager.getInstance(context).cancelUniqueWork(workName(bookId)).result.get()
    if (SilenceJob.isSafeId(bookId)) dir(context, bookId).deleteRecursively()
  }

  /** Every scan on disk, for JavaScript to show and fold in. */
  fun statuses(context: Context): List<Map<String, Any?>> =
    root(context).listFiles { f -> f.isDirectory }.orEmpty().mapNotNull { dir ->
      val job = readJob(dir) ?: return@mapNotNull null
      val result = File(dir, RESULT).takeIf { it.isFile }?.readText()
      val error = File(dir, ERROR).takeIf { it.isFile }?.readText()
      val info = WorkManager.getInstance(context).getWorkInfosForUniqueWork(workName(job.bookId)).get().lastOrNull()
      val progress = readProgress(dir)
      mapOf(
        "bookId" to job.bookId,
        "state" to when {
          result != null -> "done"
          error != null || info == null || info.state == WorkInfo.State.FAILED ||
            info.state == WorkInfo.State.CANCELLED -> "failed"
          info.state == WorkInfo.State.RUNNING -> "running"
          else -> "waiting"
        },
        "filesDone" to progress.fileIndex,
        "filesTotal" to job.files.size,
        "result" to result,
        "error" to error,
      )
    }
}

class SilenceWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  companion object {
    const val KEY_BOOK_ID = "bookId"
    private const val CHANNEL_ID = "chapters"
  }

  override suspend fun doWork(): Result {
    val bookId = inputData.getString(KEY_BOOK_ID) ?: return Result.failure()
    val dir = Silences.dir(applicationContext, bookId)
    val job = Silences.readJob(dir) ?: return Result.failure()
    // A long book can take more than the ten minutes a plain job gets.
    runCatching { setForeground(foregroundInfo(bookId)) }

    return withContext(Dispatchers.IO) {
      try {
        var progress = Silences.readProgress(dir)
        val decoder = SilenceDecoder(applicationContext)
        while (progress.fileIndex < job.files.size) {
          val earlier = progress.current
          val start = progress.positionMs
          val file = decoder.scan(
            job.files[progress.fileIndex],
            job.thresholdDb,
            job.minSilenceMs,
            start,
            earlier,
            stopped = { isStopped },
          ) { s ->
            val settled = s.settledMs
            Silences.writeProgress(
              dir,
              progress.copy(current = earlier + s.silences.filter { it.endMs <= settled }, positionMs = settled),
            )
            !isStopped
          } ?: return@withContext Result.retry()
          progress = SilenceProgress(progress.done + listOf(file.silences), progress.durations + file.durationMs)
          Silences.writeProgress(dir, progress)
        }
        Silences.writeResult(dir, progress)
        Result.success()
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Silences.writeError(dir, e.message ?: "The audio could not be read.")
        Result.failure()
      }
    }
  }

  private fun foregroundInfo(bookId: String): ForegroundInfo {
    val context = applicationContext
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Finding chapters", NotificationManager.IMPORTANCE_LOW))
    }
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_menu_search)
      .setContentTitle("Finding chapters")
      .setContentText("Listening for long silences")
      .setOngoing(true)
      .setSilent(true)
      .addAction(0, "Stop", WorkManager.getInstance(context).createCancelPendingIntent(id))
      .build()
    val notificationId = "silences:$bookId".hashCode()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(notificationId, notification)
    }
  }
}
