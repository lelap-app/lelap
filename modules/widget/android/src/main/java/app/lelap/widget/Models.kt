package app.lelap.widget

import app.lelap.text.NativeCatalog

/** What the widget shows, decided without Android so it can be tested on the JVM. */
data class WidgetModel(
  val hasBook: Boolean,
  val title: String,
  /** The chapter, else the author. */
  val subtitle: String?,
  /**
   * On the tall widget only: while a list plays, what comes next in it (M119); else the author
   * under the chapter.
   */
  val detail: String?,
  val playing: Boolean,
  val coverUri: String?,
  val skipSeconds: Long,
  val playLabel: String,
  val backLabel: String,
  val forwardLabel: String,
  /** What TalkBack says for the widget itself, which opens the player when tapped. */
  val openLabel: String,
)

enum class TileState { ACTIVE, INACTIVE }

data class TileModel(val state: TileState, val label: String, val subtitle: String)

object Models {
  /** The widget is 4x2 (cover above the controls) from this height; 4x1 below it. */
  const val TALL_MIN_HEIGHT_DP = 100

  fun isTall(minHeightDp: Int): Boolean = minHeightDp >= TALL_MIN_HEIGHT_DP

  /** In [text]'s language; the book's own title, chapter and author stay as they are. */
  fun widget(now: NowPlayingSnapshot?, text: NativeCatalog = NativeCatalog.ENGLISH): WidgetModel {
    val seconds = (now?.skipMs ?: NowPlayingSnapshot.DEFAULT_SKIP_MS) / 1000
    val playing = now?.playing == true
    val title = now?.title?.takeIf { it.isNotBlank() } ?: text.t("Nothing playing")
    val subtitle = if (now == null) text.t("Open Lelap to pick a book") else now.chapter ?: now.author
    return WidgetModel(
      hasBook = now != null,
      title = title,
      subtitle = subtitle,
      detail = now?.let { listLine(it, text) } ?: now?.author?.takeIf { now.chapter != null },
      playing = playing,
      coverUri = now?.coverUri,
      skipSeconds = seconds,
      playLabel = if (playing) text.t("Pause") else text.t("Play"),
      backLabel = text.t("Back {n} seconds", "n" to seconds),
      forwardLabel = text.t("Forward {n} seconds", "n" to seconds),
      openLabel = text.t("{what}. Opens the player.", "what" to listOfNotNull(title, subtitle).joinToString(", ")),
    )
  }

  /** The list line; the small widget has no room for it. */
  private fun listLine(now: NowPlayingSnapshot, text: NativeCatalog): String? {
    val list = now.list ?: return null
    return now.listNext?.let { text.t("Next in list: {title}", "title" to it) }
      ?: text.t("From the list “{name}”", "name" to list)
  }

  fun tile(now: NowPlayingSnapshot?, text: NativeCatalog = NativeCatalog.ENGLISH): TileModel = when {
    // Still clickable: Play resumes the last book from the position journal if there is one.
    now == null -> TileModel(TileState.INACTIVE, "Lelap", text.t("Not playing"))
    now.playing -> TileModel(TileState.ACTIVE, now.title.ifBlank { "Lelap" }, text.t("Playing"))
    else -> TileModel(TileState.INACTIVE, now.title.ifBlank { "Lelap" }, text.t("Paused"))
  }

  /** Power-of-two downsampling so the cover's longer side is at most [maxPx]. */
  fun sampleSize(width: Int, height: Int, maxPx: Int): Int {
    var sample = 1
    while (maxOf(width, height) / (sample * 2) >= maxPx) sample *= 2
    return sample
  }
}
