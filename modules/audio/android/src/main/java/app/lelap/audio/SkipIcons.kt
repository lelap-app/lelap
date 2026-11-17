package app.lelap.audio

import androidx.media3.session.CommandButton

/** Media3's skip icons carry the seconds for 5, 10, 15 and 30; other intervals get the plain one. */
object SkipIcons {
  fun back(intervalMs: Long): Int = when (intervalMs) {
    5_000L -> CommandButton.ICON_SKIP_BACK_5
    10_000L -> CommandButton.ICON_SKIP_BACK_10
    15_000L -> CommandButton.ICON_SKIP_BACK_15
    30_000L -> CommandButton.ICON_SKIP_BACK_30
    else -> CommandButton.ICON_SKIP_BACK
  }

  fun forward(intervalMs: Long): Int = when (intervalMs) {
    5_000L -> CommandButton.ICON_SKIP_FORWARD_5
    10_000L -> CommandButton.ICON_SKIP_FORWARD_10
    15_000L -> CommandButton.ICON_SKIP_FORWARD_15
    30_000L -> CommandButton.ICON_SKIP_FORWARD_30
    else -> CommandButton.ICON_SKIP_FORWARD
  }
}
