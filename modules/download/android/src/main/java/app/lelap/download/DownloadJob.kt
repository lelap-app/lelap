package app.lelap.download

import org.json.JSONArray
import org.json.JSONObject

/** [integrity] is the feed's SRI hash of an episode's file (M103), checked once it is in. */
data class JobFile(val url: String, val name: String, val size: Long, val integrity: String? = null)

/** When a download may run. Applied as WorkManager constraints. */
data class Rules(val wifiOnly: Boolean, val chargingOnly: Boolean)

/** One book to download, as written to `job.json` next to its files. */
data class DownloadJob(
  val bookId: String,
  val title: String,
  val files: List<JobFile>,
  val cover: JobFile?,
  val rules: Rules,
  /** Sent with requests to the files' own host: the login of a WebDAV server. */
  val headers: Map<String, String> = emptyMap(),
  /**
   * Where the files live: a folder the listener chose (a document tree URI), or null for the app's
   * private storage. Set by the phone when the job is first written, never sent by JavaScript.
   */
  val location: String? = null,
  /** New on every start, so a move can tell that the book was started again while it copied. */
  val revision: String? = null,
  /** The files are on the local network, which Android 17 lets Lelap reach only with permission. */
  val localNetwork: Boolean = false,
) {
  fun encode(): String = JSONObject()
    .put("bookId", bookId)
    .put("title", title)
    .put("files", JSONArray().apply { files.forEach { put(encodeFile(it)) } })
    .put("cover", cover?.let(::encodeFile) ?: JSONObject.NULL)
    .put("rules", JSONObject().put("wifiOnly", rules.wifiOnly).put("chargingOnly", rules.chargingOnly))
    .put("headers", JSONObject(headers))
    .put("location", location ?: JSONObject.NULL)
    .put("revision", revision ?: JSONObject.NULL)
    .put("localNetwork", localNetwork)
    .toString()

  companion object {
    private val SAFE_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

    /** File and folder names come from JavaScript; they must stay inside the book's folder. */
    fun isSafeName(name: String) = SAFE_NAME.matches(name) && !name.endsWith(PART_SUFFIX)

    /** Null when the JSON is unreadable or names a file outside the book's folder. */
    fun decode(json: String): DownloadJob? = try {
      val o = JSONObject(json)
      val filesJson = o.getJSONArray("files")
      val files = (0 until filesJson.length()).map { decodeFile(filesJson.getJSONObject(it)) }
      val cover = if (o.isNull("cover")) null else decodeFile(o.getJSONObject("cover"))
      val rules = o.getJSONObject("rules")
      val job = DownloadJob(
        bookId = o.getString("bookId"),
        title = o.getString("title"),
        files = files,
        cover = cover,
        rules = Rules(rules.getBoolean("wifiOnly"), rules.getBoolean("chargingOnly")),
        headers = o.optJSONObject("headers")?.let { h -> h.keys().asSequence().associateWith { h.getString(it) } }
          ?: emptyMap(),
        location = if (o.isNull("location")) null else o.optString("location").ifEmpty { null },
        revision = if (o.isNull("revision")) null else o.optString("revision"),
        localNetwork = o.optBoolean("localNetwork", false),
      )
      val names = files.map { it.name } + listOfNotNull(cover?.name, job.bookId)
      job.takeIf { files.isNotEmpty() && names.all(::isSafeName) && names.toSet().size == names.size }
    } catch (e: org.json.JSONException) {
      null
    }

    private fun encodeFile(f: JobFile) =
      JSONObject().put("url", f.url).put("name", f.name).put("size", f.size)
        .apply { f.integrity?.let { put("integrity", it) } }

    private fun decodeFile(o: JSONObject) = JobFile(
      o.getString("url"),
      o.getString("name"),
      o.optLong("size", 0L),
      if (o.isNull("integrity")) null else o.optString("integrity").ifEmpty { null },
    )
  }
}

const val PART_SUFFIX = ".part"
