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
) {
  fun encode(): String = JSONObject()
    .put("bookId", bookId)
    .put("files", JSONArray(files))
    .put("thresholdDb", thresholdDb)
    .put("minSilenceMs", minSilenceMs)
    .toString()

  companion object {
    private val SAFE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

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
