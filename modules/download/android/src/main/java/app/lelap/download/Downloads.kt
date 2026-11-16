package app.lelap.download

import android.content.Context
import android.os.StatFs
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.io.File
import java.util.concurrent.TimeUnit

/** Files and work for downloads. Each book has a folder with `job.json`, its parts and its cover. */
object Downloads {
  private const val TAG = "lelap-download"
  private const val JOB_FILE = "job.json"
  private const val ERROR_FILE = "error.txt"

  // No-backup storage: Android's auto backup must not try to upload gigabytes of audio.
  fun root(context: Context) = File(context.noBackupFilesDir, "downloads")

  fun bookDir(context: Context, bookId: String) = File(root(context), bookId)

  private fun workName(bookId: String) = "download:$bookId"

  fun readJob(dir: File): DownloadJob? =
    File(dir, JOB_FILE).takeIf { it.isFile }?.readText()?.let(DownloadJob::decode)

  fun writeError(dir: File, message: String) = File(dir, ERROR_FILE).writeText(message)

  fun clearError(dir: File) = File(dir, ERROR_FILE).delete()

  fun enqueue(context: Context, job: DownloadJob) {
    val dir = bookDir(context, job.bookId)
    dir.mkdirs()
    val tmp = File(dir, "$JOB_FILE.tmp")
    tmp.writeText(job.encode())
    tmp.renameTo(File(dir, JOB_FILE))
    clearError(dir)

    val constraints = Constraints.Builder()
      .setRequiredNetworkType(if (job.rules.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
      .setRequiresCharging(job.rules.chargingOnly)
      .setRequiresStorageNotLow(true)
      .build()
    val request = OneTimeWorkRequestBuilder<DownloadWorker>()
      .setConstraints(constraints)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
      .setInputData(workDataOf(DownloadWorker.KEY_BOOK_ID to job.bookId))
      .addTag(TAG)
      .build()
    // Replacing running work stops it; the new run resumes the partial file.
    WorkManager.getInstance(context)
      .enqueueUniqueWork(workName(job.bookId), ExistingWorkPolicy.REPLACE, request)
  }

  fun remove(context: Context, bookId: String) {
    WorkManager.getInstance(context).cancelUniqueWork(workName(bookId)).result.get()
    if (DownloadJob.isSafeName(bookId)) bookDir(context, bookId).deleteRecursively()
  }

  /** Re-enqueues every unfinished download with new rules. */
  fun setRules(context: Context, rules: Rules) {
    for (dir in bookDirs(context)) {
      val job = readJob(dir) ?: continue
      if (!partsDone(dir, job)) enqueue(context, job.copy(rules = rules))
    }
  }

  private fun bookDirs(context: Context) = root(context).listFiles { f -> f.isDirectory }.orEmpty().toList()

  private fun partsDone(dir: File, job: DownloadJob) = job.files.all { File(dir, it.name).isFile }

  private fun workState(context: Context, bookId: String): WorkState {
    val info = WorkManager.getInstance(context).getWorkInfosForUniqueWork(workName(bookId)).get()
      .lastOrNull() ?: return WorkState.NONE
    return when (info.state) {
      WorkInfo.State.ENQUEUED -> WorkState.ENQUEUED
      WorkInfo.State.BLOCKED -> WorkState.BLOCKED
      WorkInfo.State.RUNNING -> WorkState.RUNNING
      WorkInfo.State.SUCCEEDED -> WorkState.SUCCEEDED
      WorkInfo.State.FAILED -> WorkState.FAILED
      WorkInfo.State.CANCELLED -> WorkState.CANCELLED
    }
  }

  /** Every download on disk, for JavaScript to fold into SQLite. */
  fun statuses(context: Context): List<Map<String, Any?>> = bookDirs(context).mapNotNull { dir ->
    val job = readJob(dir) ?: return@mapNotNull null
    val done = job.files.filter { File(dir, it.name).isFile }
    val partial = job.files.sumOf { File(dir, it.name + PART_SUFFIX).takeIf { f -> f.isFile }?.length() ?: 0L }
    val error = File(dir, ERROR_FILE).takeIf { it.isFile }?.readText()
    mapOf(
      "bookId" to job.bookId,
      "state" to DownloadRules.state(done.size == job.files.size, workState(context, job.bookId), error != null),
      "bytesDone" to (done.sumOf { File(dir, it.name).length() } + partial).toDouble(),
      "bytesTotal" to job.files.sumOf { it.size }.toDouble(),
      "files" to done.map { it.name },
      "cover" to job.cover?.name?.takeIf { File(dir, it).isFile },
      "error" to error,
    )
  }

  fun storage(context: Context): Map<String, Double> {
    val stat = StatFs(context.noBackupFilesDir.path)
    val used = root(context).walkTopDown().filter { it.isFile }.sumOf { it.length() }
    return mapOf(
      "freeBytes" to stat.availableBytes.toDouble(),
      "totalBytes" to stat.totalBytes.toDouble(),
      "usedBytes" to used.toDouble(),
    )
  }
}
