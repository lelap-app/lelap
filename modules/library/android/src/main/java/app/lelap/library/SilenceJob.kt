package app.lelap.library

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** One book to scan for silences, as JavaScript sends it and `job.json` keeps it. */
data class SilenceJob(
  val bookId: String,
  /** `content://` URIs of a library folder or `file://` paths of downloads; never a server. */
  val files: List<String>,
  val thresholdDb: Double,
  val minSilenceMs: Long,
  /**
   * Set by [Silences.enqueue] for each new scan. A stopped worker still finishing finds another
   * run in `job.json` and writes nothing into the new scan's folder.
   */
  val run: String? = null,
  /** For the notification (M85); older jobs have none. */
  val title: String? = null,
  /** Each file's stored length, 0 when unknown, for how far the scan is through the book (M85). */
  val durationsMs: List<Long> = emptyList(),
) {
  fun encode(): String = JSONObject()
    .put("bookId", bookId)
    .put("files", JSONArray(files))
    .put("thresholdDb", thresholdDb)
    .put("minSilenceMs", minSilenceMs)
    .put("run", run)
    .put("title", title)
    .put("durationsMs", JSONArray(durationsMs))
    .toString()

  /**
   * How far [progress] is through the book, from 0 to 1: by the stored lengths when every file has
   * one, else by whole files.
   */
  fun fractionDone(progress: SilenceProgress): Double {
    if (files.isEmpty()) return 0.0
    val byLength = durationsMs.size == files.size && durationsMs.all { it > 0 }
    val fraction = if (byLength) {
      (durationsMs.take(progress.fileIndex).sum() + progress.positionMs).toDouble() / durationsMs.sum()
    } else {
      progress.fileIndex.toDouble() / files.size
    }
    return fraction.coerceIn(0.0, 1.0)
  }

  fun sameRun(token: String?): Boolean = run == token

  companion object {
    private val SAFE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
    private const val MAX_TITLE = 200

    /** Book IDs name a folder; they must stay inside the scans folder. */
    fun isSafeId(id: String) = SAFE_ID.matches(id) && !id.contains("..")

    /** Null when unreadable, when the book ID could leave the scans folder, or a file is remote. */
    fun decode(json: String): SilenceJob? = try {
      val o = JSONObject(json)
      val array = o.getJSONArray("files")
      val job = SilenceJob(
        bookId = o.getString("bookId"),
        files = List(array.length()) { array.getString(it) },
        thresholdDb = o.getDouble("thresholdDb"),
        minSilenceMs = o.getLong("minSilenceMs"),
        // JavaScript's job has none; enqueue gives it one.
        run = if (o.isNull("run")) null else o.getString("run"),
        title = if (o.isNull("title")) null else o.optString("title").takeIf { it.isNotBlank() }?.take(MAX_TITLE),
        durationsMs = o.optJSONArray("durationsMs")?.let { a ->
          List(a.length()) { a.optLong(it).coerceAtLeast(0L) }
        } ?: emptyList(),
      )
      job.takeIf {
        isSafeId(it.bookId) && it.files.isNotEmpty() &&
          it.files.all { f -> f.startsWith("content://") || f.startsWith("file://") }
      }
    } catch (e: JSONException) {
      null
    }
  }
}

/**
 * How far a scan got: silences of the files it finished, and of the file it is in up to
 * [positionMs]. Written now and then, so a scan stopped for a low battery goes on from there.
 */
data class SilenceProgress(
  val done: List<List<Silence>> = emptyList(),
  /** The decoded length of each finished file, which tags only estimate. */
  val durations: List<Long> = emptyList(),
  val current: List<Silence> = emptyList(),
  val positionMs: Long = 0L,
) {
  val fileIndex: Int get() = done.size

  fun encode(): String = JSONObject()
    .put("done", JSONArray(done.map(::encodeList)))
    .put("durations", JSONArray(durations))
    .put("current", encodeList(current))
    .put("positionMs", positionMs)
    .toString()

  companion object {
    fun decode(json: String?): SilenceProgress = try {
      if (json == null) {
        SilenceProgress()
      } else {
        val o = JSONObject(json)
        val done = o.getJSONArray("done")
        val durations = o.getJSONArray("durations")
        SilenceProgress(
          done = List(done.length()) { decodeList(done.getJSONArray(it)) },
          durations = List(durations.length()) { durations.getLong(it) },
          current = decodeList(o.getJSONArray("current")),
          positionMs = o.getLong("positionMs"),
        )
      }
    } catch (e: JSONException) {
      SilenceProgress()
    }

    /** What JavaScript reads: each file's decoded length and its silences. */
    fun encodeResult(progress: SilenceProgress): String = JSONArray(
      progress.done.mapIndexed { i, list ->
        JSONObject().put("durationMs", progress.durations.getOrElse(i) { 0L }).put("silences", encodeList(list))
      },
    ).toString()

    fun encodeList(list: List<Silence>) =
      JSONArray(list.map { JSONObject().put("startMs", it.startMs).put("endMs", it.endMs) })

    private fun decodeList(a: JSONArray) = List(a.length()) {
      val s = a.getJSONObject(it)
      Silence(s.getLong("startMs"), s.getLong("endMs"))
    }
  }
}
