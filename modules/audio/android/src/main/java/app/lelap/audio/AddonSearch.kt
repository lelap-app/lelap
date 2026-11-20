package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** An add-on's search catalog (M147), as the app lists it: the add-on's base URL ends in `/`. */
data class SearchCatalog(val base: String, val type: String, val id: String, val addon: String)

/** One item an add-on's search found. */
data class AddonHit(val type: String, val id: String, val name: String, val author: String?, val cover: String?, val addon: String)

/**
 * Voice search in the installed add-ons' search catalogs, straight over HTTP so it works with the
 * app closed. Only remote add-ons: in-app ones need the app's sandbox, too slow to start for a
 * car that waits a few seconds.
 */
object AddonSearch {
  /** Every add-on gets this long, all at once; what has not answered by then is left out. */
  const val DEADLINE_MS = 3_000L

  /** Items per catalog worth offering by voice. */
  private const val PER_CATALOG = 8

  /** An add-on's item in the car: `addon:<type>/<id>`. Types have no slash; IDs may. */
  const val PREFIX = "addon:"

  fun mediaId(hit: AddonHit): String = "$PREFIX${hit.type}/${hit.id}"

  /** The type and ID behind an add-on item's media ID, or null for anything else. */
  fun parseMediaId(mediaId: String): Pair<String, String>? {
    if (!mediaId.startsWith(PREFIX)) return null
    val rest = mediaId.removePrefix(PREFIX)
    val slash = rest.indexOf('/')
    if (slash <= 0 || slash == rest.lastIndex) return null
    return rest.substring(0, slash) to rest.substring(slash + 1)
  }

  /** The catalog's search address, encoded as `@lelap/sdk`'s `catalogPath` does it. */
  fun url(catalog: SearchCatalog, query: String): String =
    "${catalog.base}catalog/${encode(catalog.type)}/${encode(catalog.id)}/search=${encode(query)}.json"

  /** JavaScript's `encodeURIComponent`, so the address and its cache key match the app's. */
  fun encode(text: String): String {
    val out = StringBuilder()
    for (byte in text.toByteArray(Charsets.UTF_8)) {
      val c = byte.toInt() and 0xff
      val ch = c.toChar()
      if (c < 0x80 && (ch.isLetterOrDigit() || ch in "-_.!~*'()")) out.append(ch)
      else out.append('%').append("%02X".format(c))
    }
    return out.toString()
  }

  /** The items of a catalog's answer; ones without an ID or name are skipped. */
  fun parse(body: String, catalog: SearchCatalog): List<AddonHit> = try {
    val metas = JSONObject(body).optJSONArray("metas") ?: JSONArray()
    (0 until metas.length()).mapNotNull { i ->
      val meta = metas.optJSONObject(i) ?: return@mapNotNull null
      val id = meta.optString("id").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
      val name = meta.optString("name").takeIf { it.isNotBlank() } ?: return@mapNotNull null
      AddonHit(
        type = meta.optString("type").ifEmpty { catalog.type },
        id = id,
        name = name,
        author = meta.optString("author").takeIf { it.isNotBlank() },
        cover = meta.optString("cover").takeIf { it.startsWith("https://") },
        addon = catalog.addon,
      )
    }.take(PER_CATALOG)
  } catch (e: JSONException) {
    emptyList()
  }

  fun candidate(hit: AddonHit) = VoiceCandidate(
    id = mediaId(hit),
    title = hit.name,
    author = hit.author,
    kind = VoiceKind.BOOK,
    local = false,
    subtitle = listOfNotNull(hit.author, hit.addon).joinToString(" · "),
    artworkUri = hit.cover,
  )

  fun decodeCatalogs(array: JSONArray?): List<SearchCatalog> = (0 until (array?.length() ?: 0)).mapNotNull { i ->
    val o = array!!.optJSONObject(i) ?: return@mapNotNull null
    val base = o.optString("base")
    // Only the add-on's own web address; anything else is not for this path.
    if (!base.startsWith("https://") && !base.startsWith("http://")) return@mapNotNull null
    val type = o.optString("type").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
    val id = o.optString("id").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
    SearchCatalog(if (base.endsWith("/")) base else "$base/", type, id, o.optString("addon"))
  }

  fun encodeCatalogs(catalogs: List<SearchCatalog>) = JSONArray(
    catalogs.map { JSONObject().put("base", it.base).put("type", it.type).put("id", it.id).put("addon", it.addon) },
  )

  // Daemon threads: a search left running never keeps the service's process alive.
  private val pool: ExecutorService = Executors.newCachedThreadPool { task ->
    Thread(task, "lelap-voice-search").apply { isDaemon = true }
  }

  /**
   * Asks every catalog at once and returns what came back within [deadlineMs]. Blocks; call it
   * off the main thread.
   */
  fun search(catalogs: List<SearchCatalog>, query: String, deadlineMs: Long = DEADLINE_MS): List<AddonHit> {
    if (catalogs.isEmpty() || query.isBlank()) return emptyList()
    val tasks = catalogs.map { catalog -> Callable { parse(get(url(catalog, query), deadlineMs), catalog) } }
    val futures = try {
      pool.invokeAll(tasks, deadlineMs, TimeUnit.MILLISECONDS)
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
      return emptyList()
    }
    return futures.flatMap { future ->
      if (future.isCancelled) emptyList() else try { future.get() } catch (e: Exception) { emptyList() }
    }
  }

  /** Runs [block] on the search's own threads. */
  fun submit(block: () -> Unit) {
    pool.execute(block)
  }

  private fun get(url: String, timeoutMs: Long): String {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = timeoutMs.toInt()
      connection.readTimeout = timeoutMs.toInt()
      connection.instanceFollowRedirects = true
      connection.setRequestProperty("Accept", "application/json")
      if (connection.responseCode !in 200..299) throw IOException("HTTP ${connection.responseCode}")
      return connection.inputStream.bufferedReader().use { it.readText() }
    } finally {
      connection.disconnect()
    }
  }
}
