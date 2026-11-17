package app.lelap.widget

import android.content.Context
import org.json.JSONObject

/**
 * What plays now, as `modules/audio`'s PlaybackService saves it (`NowPlaying` there, same JSON
 * keys and preference names; change both together). It outlives the service, so the widget and
 * tile show the last book with the app closed.
 */
data class NowPlayingSnapshot(
  val bookId: String,
  val title: String,
  val chapter: String?,
  val author: String?,
  val coverUri: String?,
  val playing: Boolean,
  val skipMs: Long,
) {
  companion object {
    const val PREFS = "lelap_now_playing"
    const val KEY = "nowPlaying"
    const val DEFAULT_SKIP_MS = 30_000L

    /** Null when nothing is loaded, or the saved value can't be read. */
    fun decode(json: String?): NowPlayingSnapshot? {
      if (json.isNullOrBlank()) return null
      val o = runCatching { JSONObject(json) }.getOrNull() ?: return null
      val bookId = o.optString("bookId").takeIf { it.isNotEmpty() } ?: return null
      return NowPlayingSnapshot(
        bookId = bookId,
        title = o.optString("title"),
        chapter = o.optStringOrNull("chapter"),
        author = o.optStringOrNull("author"),
        coverUri = o.optStringOrNull("coverUri"),
        playing = o.optBoolean("playing", false),
        skipMs = o.optLong("skipMs", DEFAULT_SKIP_MS).takeIf { it > 0 } ?: DEFAULT_SKIP_MS,
      )
    }

    fun read(context: Context): NowPlayingSnapshot? =
      decode(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null))

    private fun JSONObject.optStringOrNull(key: String): String? =
      if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
  }
}
