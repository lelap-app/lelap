package app.lelap.widget

/** What the widget shows, decided without Android so it can be tested on the JVM. */
data class WidgetModel(
  val hasBook: Boolean,
  val title: String,
  /** The chapter, else the author. */
  val subtitle: String?,
  /** The author under the chapter, on the tall widget only. */
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

  fun widget(now: NowPlayingSnapshot?): WidgetModel {
    val seconds = (now?.skipMs ?: NowPlayingSnapshot.DEFAULT_SKIP_MS) / 1000
    val playing = now?.playing == true
    val title = now?.title?.takeIf { it.isNotBlank() } ?: "Nothing playing"
    val subtitle = if (now == null) "Open Lelap to pick a book" else now.chapter ?: now.author
    return WidgetModel(
      hasBook = now != null,
      title = title,
      subtitle = subtitle,
      detail = now?.author?.takeIf { now.chapter != null },
      playing = playing,
      coverUri = now?.coverUri,
      skipSeconds = seconds,
      playLabel = if (playing) "Pause" else "Play",
      backLabel = "Back $seconds seconds",
      forwardLabel = "Forward $seconds seconds",
      openLabel = listOfNotNull(title, subtitle).joinToString(", ") + ". Opens the player.",
    )
  }

  fun tile(now: NowPlayingSnapshot?): TileModel = when {
    // Still clickable: Play resumes the last book from the position journal if there is one.
    now == null -> TileModel(TileState.INACTIVE, "Lelap", "Not playing")
    now.playing -> TileModel(TileState.ACTIVE, now.title.ifBlank { "Lelap" }, "Playing")
    else -> TileModel(TileState.INACTIVE, now.title.ifBlank { "Lelap" }, "Paused")
  }

  /** Power-of-two downsampling so the cover's longer side is at most [maxPx]. */
  fun sampleSize(width: Int, height: Int, maxPx: Int): Int {
    var sample = 1
    while (maxOf(width, height) / (sample * 2) >= maxPx) sample *= 2
    return sample
  }
}
