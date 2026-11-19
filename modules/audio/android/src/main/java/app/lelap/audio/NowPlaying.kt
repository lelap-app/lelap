package app.lelap.audio

import org.json.JSONObject

/**
 * What plays now, for the home screen widget and the Quick Settings tile (`modules/widget`), which
 * read it from [Commands.NOW_PLAYING_PREFS] with the app closed. `modules/widget` decodes the same
 * JSON keys; change both together.
 */
data class NowPlaying(
  val bookId: String,
  val title: String,
  val chapter: String?,
  val author: String?,
  val coverUri: String?,
  val playing: Boolean,
  val skipMs: Long,
  /** The list that plays (M119), and the title of its next item; null without one, or at its end. */
  val list: String? = null,
  val listNext: String? = null,
) {
  fun encode(): String = JSONObject()
    .put("bookId", bookId)
    .put("title", title)
    .putOpt("chapter", chapter)
    .putOpt("author", author)
    .putOpt("coverUri", coverUri)
    .put("playing", playing)
    .put("skipMs", skipMs)
    .putOpt("list", list)
    .putOpt("listNext", listNext)
    .toString()

  companion object {
    /** Written when nothing is loaded (another profile unloaded the book). */
    const val NOTHING = "{}"
  }
}
