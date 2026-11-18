package app.lelap.library

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
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.lelap.text.NativeText
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
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
  /** Present while the scan waits because the worker found the battery low. */
  private const val LOW_BATTERY = "low-battery"
  /** How long a scan stopped for a low battery waits before it looks again. */
  private const val LOW_BATTERY_RETRY_MINUTES = 10L

  fun root(context: Context) = File(context.noBackupFilesDir, "silences")

  fun dir(context: Context, bookId: String) = File(root(context), bookId)

  private fun workName(bookId: String) = "silences:$bookId"

  fun readJob(dir: File): SilenceJob? = File(dir, JOB).takeIf { it.isFile }?.readText()?.let(SilenceJob::decode)

  fun readProgress(dir: File) = SilenceProgress.decode(File(dir, PROGRESS).takeIf { it.isFile }?.readText())

  /** Held while `job.json` is replaced and while a worker checks it before writing. */
  private val lock = Any()

  /** Runs [write] only while [dir] still holds scan [run]; false when it holds another or none. */
  fun writeFor(dir: File, run: String?, write: () -> Unit): Boolean = synchronized(lock) {
    if (readJob(dir)?.sameRun(run) != true) return false
    write()
    true
  }

  fun writeProgress(dir: File, progress: SilenceProgress) = writeAtomically(File(dir, PROGRESS), progress.encode())

  fun writeResult(dir: File, progress: SilenceProgress) =
    writeAtomically(File(dir, RESULT), SilenceProgress.encodeResult(progress))

  fun writeError(dir: File, message: String) = File(dir, ERROR).writeText(message)

  fun markLowBattery(dir: File, low: Boolean) {
    val marker = File(dir, LOW_BATTERY)
    if (low) marker.writeText("") else marker.delete()
  }

  private fun writeAtomically(target: File, text: String) {
    val tmp = File(target.parentFile, "${target.name}.tmp")
    tmp.writeText(text)
    tmp.renameTo(target)
  }

  fun enqueue(context: Context, job: SilenceJob) {
    val dir = dir(context, job.bookId)
    val run = UUID.randomUUID().toString()
    synchronized(lock) {
      dir.deleteRecursively()
      dir.mkdirs()
      writeAtomically(File(dir, JOB), job.copy(run = run).encode())
    }
    // The listener asked for this scan, so it starts now (M85). A battery constraint let Android's
    // flexible scheduling hold it back at 84 %; the worker checks the battery itself instead, and
    // a scan stopped for a low battery goes on from its last checkpoint.
    val request = OneTimeWorkRequestBuilder<SilenceWorker>()
      .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
      .setBackoffCriteria(BackoffPolicy.LINEAR, LOW_BATTERY_RETRY_MINUTES, TimeUnit.MINUTES)
      .setInputData(workDataOf(SilenceWorker.KEY_BOOK_ID to job.bookId, SilenceWorker.KEY_RUN to run))
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
      val state = when {
        result != null -> "done"
        error != null || info == null || info.state == WorkInfo.State.FAILED ||
          info.state == WorkInfo.State.CANCELLED -> "failed"
        info.state == WorkInfo.State.RUNNING -> "running"
        else -> "waiting"
      }
      mapOf(
        "bookId" to job.bookId,
        "state" to state,
        "filesDone" to progress.fileIndex,
        "filesTotal" to job.files.size,
        "fraction" to job.fractionDone(progress),
        // Only while it is low now: a scan waiting out its retry once the battery is fine is
        // simply waiting to start.
        "lowBattery" to (state == "waiting" && File(dir, LOW_BATTERY).isFile && Battery.isLow(context)),
        "result" to result,
        "error" to error,
      )
    }
}

class SilenceWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  companion object {
    const val KEY_BOOK_ID = "bookId"
    const val KEY_RUN = "run"
    private const val CHANNEL_ID = "chapters"
    /** How often a running scan looks at the battery and moves the notification's bar. */
    private const val CHECK_EVERY_MS = 5_000L
    private const val BAR_STEPS = 1_000
  }

  private fun job(): SilenceJob? {
    val bookId = inputData.getString(KEY_BOOK_ID) ?: return null
    return Silences.readJob(Silences.dir(applicationContext, bookId))?.takeIf { it.sameRun(inputData.getString(KEY_RUN)) }
  }

  // Expedited work runs as a foreground service before Android 12, which asks for this.
  override suspend fun getForegroundInfo(): ForegroundInfo =
    foregroundInfo(inputData.getString(KEY_BOOK_ID).orEmpty(), job()?.title, 0.0)

  override suspend fun doWork(): Result {
    val bookId = inputData.getString(KEY_BOOK_ID) ?: return Result.failure()
    val dir = Silences.dir(applicationContext, bookId)
    val run = inputData.getString(KEY_RUN)
    val job = job() ?: return Result.failure()
    if (Battery.isLow(applicationContext)) {
      Silences.writeFor(dir, run) { Silences.markLowBattery(dir, true) }
      return Result.retry()
    }
    if (!Silences.writeFor(dir, run) { Silences.markLowBattery(dir, false) }) return Result.failure()
    // A long book can take more than the ten minutes a plain job gets.
    runCatching { setForeground(foregroundInfo(bookId, job.title, job.fractionDone(Silences.readProgress(dir)))) }

    return withContext(Dispatchers.IO) {
      try {
        var progress = Silences.readProgress(dir)
        var replaced = false
        var lowBattery = false
        var lastCheck = SystemClock.elapsedRealtime()
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
            val current = progress.copy(current = earlier + s.silences.filter { it.endMs <= settled }, positionMs = settled)
            replaced = !Silences.writeFor(dir, run) { Silences.writeProgress(dir, current) }
            val now = SystemClock.elapsedRealtime()
            if (!replaced && now - lastCheck >= CHECK_EVERY_MS) {
              lastCheck = now
              lowBattery = Battery.isLow(applicationContext)
              if (!lowBattery) setForegroundAsync(foregroundInfo(bookId, job.title, job.fractionDone(current)))
            }
            !isStopped && !replaced && !lowBattery
          }
          if (file == null) {
            if (replaced) return@withContext Result.failure()
            if (lowBattery) Silences.writeFor(dir, run) { Silences.markLowBattery(dir, true) }
            return@withContext Result.retry()
          }
          progress = SilenceProgress(progress.done + listOf(file.silences), progress.durations + file.durationMs)
          val next = progress
          if (!Silences.writeFor(dir, run) { Silences.writeProgress(dir, next) }) return@withContext Result.failure()
        }
        val done = progress
        Silences.writeFor(dir, run) { Silences.writeResult(dir, done) }
        Result.success()
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        Silences.writeFor(dir, run) { Silences.writeError(dir, e.message ?: "The audio could not be read.") }
        Result.failure()
      }
    }
  }

  private fun foregroundInfo(bookId: String, title: String?, fraction: Double): ForegroundInfo {
    val context = applicationContext
    NativeText.channel(context, CHANNEL_ID, "Finding chapters", NotificationManager.IMPORTANCE_LOW)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_menu_search)
      .setContentTitle(
        if (title != null) {
          NativeText.t(context, "Finding chapters in {title}", "title" to title)
        } else {
          NativeText.t(context, "Finding chapters")
        },
      )
      .setContentText(NativeText.t(context, "Listening for long silences"))
      // A bar for how far it is through the book, with no number beside it.
      .setProgress(BAR_STEPS, (fraction * BAR_STEPS).toInt(), false)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .addAction(0, NativeText.t(context, "Stop"), WorkManager.getInstance(context).createCancelPendingIntent(id))
      .build()
    val notificationId = "silences:$bookId".hashCode()
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(notificationId, notification)
    }
  }
}
