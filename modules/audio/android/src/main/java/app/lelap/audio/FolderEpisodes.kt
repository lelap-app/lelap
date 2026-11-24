package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** A file of a book with per-file marks that played to its end, for the app to mark played. */
data class PlayedFile(val bookId: String, val fileLocation: String, val at: Long)

/**
 * A book of episode files shown as a podcast (M157, M158), as the service plays it with the app
 * closed: playing on into an episode already played goes on to the next one not played, and each
 * file played to its end is logged, so the app marks it played when it next starts.
 */
object FolderEpisodes {
  /**
   * Where to go when the player went on by itself from file [fromIndex] into [toIndex], the next
   * one, and that one is played: the next file not played after it, where it was left. Null when
   * nothing needs skipping, or every file after it is played (it then plays on, as in the app).
   */
  fun skipTarget(playlist: BookPlaylist, fromIndex: Int, toIndex: Int): Pair<Int, Long>? {
    if (!playlist.skipsPlayed || toIndex != fromIndex + 1) return null
    if (playlist.files.getOrNull(toIndex)?.played != true) return null
    val next = (toIndex + 1 until playlist.files.size).firstOrNull { !playlist.files[it].played } ?: return null
    return next to playlist.files[next].leftAtMs.coerceAtLeast(0L)
  }

  /** [playlist] with file [index] played, so a later skip within the same load knows it too. */
  fun withPlayed(playlist: BookPlaylist, index: Int): BookPlaylist {
    val file = playlist.files.getOrNull(index) ?: return playlist
    if (file.played) return playlist
    return playlist.copy(files = playlist.files.toMutableList().also { it[index] = file.copy(played = true, leftAtMs = 0L) })
  }

  /** Keeps the last [max] files, in case the app stays closed for many of them. */
  fun appendPlayed(json: String?, file: PlayedFile, max: Int = 200): String =
    encodePlayed((decodePlayed(json) + file).takeLast(max))

  fun encodePlayed(list: List<PlayedFile>): String = JSONArray(
    list.map { JSONObject().put("bookId", it.bookId).put("fileLocation", it.fileLocation).put("at", it.at) },
  ).toString()

  fun decodePlayed(json: String?): List<PlayedFile> = try {
    val array = JSONArray(json ?: "[]")
    List(array.length()) {
      val o = array.getJSONObject(it)
      PlayedFile(o.getString("bookId"), o.getString("fileLocation"), o.getLong("at"))
    }
  } catch (e: JSONException) {
    emptyList()
  }
}
