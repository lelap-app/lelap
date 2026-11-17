package app.lelap.download

import android.content.Context
import android.net.Uri
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

/**
 * Files and work for downloads. Each book has a private folder with its `job.json`; its parts and
 * cover sit next to it, or in a folder the listener chose (`job.location`).
 */
object Downloads {
  private const val TAG = "lelap-download"
  private const val JOB_FILE = "job.json"
  private const val ERROR_FILE = "error.txt"
  private const val LOCATION_FILE = "location.txt"

  // No-backup storage: Android's auto backup must not try to upload gigabytes of audio.
  fun root(context: Context) = File(context.noBackupFilesDir, "downloads")

  fun bookDir(context: Context, bookId: String) = File(root(context), bookId)

  private fun workName(bookId: String) = "download:$bookId"

  fun readJob(dir: File): DownloadJob? =
    File(dir, JOB_FILE).takeIf { it.isFile }?.readText()?.let(DownloadJob::decode)

  /** Written to a temporary file and renamed, so a stop never leaves half a job behind. */
  fun writeJob(dir: File, job: DownloadJob) {
    dir.mkdirs()
    val tmp = File(dir, "$JOB_FILE.tmp")
    tmp.writeText(job.encode())
    if (!tmp.renameTo(File(dir, JOB_FILE))) throw java.io.IOException("Could not save the download job.")
  }

  fun writeError(dir: File, message: String) = File(dir, ERROR_FILE).writeText(message)

  fun clearError(dir: File) = File(dir, ERROR_FILE).delete()

  /** The folder new downloads go to: a tree URI, or null for private storage. */
  fun location(context: Context): String? =
    File(root(context), LOCATION_FILE).takeIf { it.isFile }?.readText()?.trim()?.ifEmpty { null }

  fun setLocation(context: Context, uri: String?) {
    val root = root(context)
    root.mkdirs()
    val tmp = File(root, "$LOCATION_FILE.tmp")
    tmp.writeText(uri ?: "")
    tmp.renameTo(File(root, LOCATION_FILE))
  }

  fun place(context: Context, uri: String?): Place =
    if (uri == null) PrivatePlace(root(context)) else TreePlace(context, Uri.parse(uri))

  /** Held while a job's location is read and written, so a move and a new start never cross. */
  val lock = Any()

  fun enqueue(context: Context, job: DownloadJob) = synchronized(lock) {
    val dir = bookDir(context, job.bookId)
    // A book keeps the place its files are in; a new one goes to the current folder.
    val existing = readJob(dir)
    val location = if (existing != null) existing.location else location(context)
    writeJob(dir, job.copy(location = location))
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
    // Replacing running work stops it; the new run resumes the partial file. Waiting for the
    // enqueue means a move that checks this book's work afterwards sees it.
    WorkManager.getInstance(context)
      .enqueueUniqueWork(workName(job.bookId), ExistingWorkPolicy.REPLACE, request)
      .result.get()
    Unit
  }

  fun remove(context: Context, bookId: String) {
    WorkManager.getInstance(context).cancelUniqueWork(workName(bookId)).result.get()
    if (!DownloadJob.isSafeName(bookId)) return
    val dir = bookDir(context, bookId)
    readJob(dir)?.location?.let { uri ->
      // A missing SD card keeps its copy; the files are the listener's to delete from there.
      runCatching { place(context, uri).takeIf { it.available() }?.removeFolder(bookId) }
    }
    dir.deleteRecursively()
  }

  /** Re-enqueues every unfinished download with new rules. */
  fun setRules(context: Context, rules: Rules) {
    for (dir in bookDirs(context)) {
      val job = readJob(dir) ?: continue
      val folder = runCatching { place(context, job.location).folder(job.bookId, create = false) }.getOrNull()
      if (folder == null || !partsDone(folder, job)) enqueue(context, job.copy(rules = rules))
    }
  }

  fun bookDirs(context: Context) = root(context).listFiles { f -> f.isDirectory }.orEmpty().toList()

  private fun partsDone(folder: BookFolder, job: DownloadJob): Boolean {
    val files = folder.list()
    return job.files.all { it.name in files }
  }

  fun workState(context: Context, bookId: String): WorkState {
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
  fun statuses(context: Context): List<Map<String, Any?>> {
    val jobs = bookDirs(context).mapNotNull { dir -> readJob(dir)?.let { dir to it } }
    // One listing per place rather than one per book; a place that can't be reached lists nothing.
    val listings = jobs.map { it.second.location }.distinct().associateWith { uri ->
      val place = place(context, uri)
      if (place.available()) runCatching { place.folders() }.getOrNull() else null
    }
    return jobs.map { (dir, job) ->
      val folders = listings[job.location]
      val folder = folders?.get(job.bookId)
      val files = folder?.let { runCatching { it.list() }.getOrNull() }.orEmpty()
      val done = job.files.filter { it.name in files }
      val partial = job.files.sumOf { files[it.name + PART_SUFFIX] ?: 0L }
      val cover = job.cover?.name?.takeIf { it in files }
      val paths = folder?.let { f -> runCatching { f.paths(done.map { it.name } + listOfNotNull(cover)) }.getOrNull() }.orEmpty()
      val error = File(dir, ERROR_FILE).takeIf { it.isFile }?.readText()
      mapOf(
        "bookId" to job.bookId,
        "state" to DownloadRules.state(done.size == job.files.size, workState(context, job.bookId), error != null),
        "bytesDone" to (done.sumOf { files[it.name] ?: 0L } + partial).toDouble(),
        "bytesTotal" to job.files.sumOf { it.size }.toDouble(),
        "files" to done.map { it.name },
        "cover" to cover,
        "paths" to paths,
        // The folder is there but can't be reached: an SD card taken out. Nothing is lost.
        "unavailable" to (folders == null),
        "error" to error,
      )
    }
  }

  /** Free and total space where new downloads go, and what downloads take up in every place. */
  fun storage(context: Context): Map<String, Double> {
    val current = place(context, location(context))
    val space = runCatching { current.takeIf { it.available() }?.space() }.getOrNull()
      ?: PrivatePlace(root(context)).space()
    val jobs = bookDirs(context).mapNotNull(::readJob)
    var used = 0L
    for (uri in jobs.map { it.location }.distinct()) {
      val place = place(context, uri)
      if (!place.available()) continue
      val folders = runCatching { place.folders() }.getOrNull() ?: continue
      for (job in jobs.filter { it.location == uri }) {
        used += folders[job.bookId]?.let { runCatching { it.list().values.sum() }.getOrNull() } ?: 0L
      }
    }
    return mapOf(
      "freeBytes" to space.first.toDouble(),
      "totalBytes" to space.second.toDouble(),
      "usedBytes" to used.toDouble(),
    )
  }
}
