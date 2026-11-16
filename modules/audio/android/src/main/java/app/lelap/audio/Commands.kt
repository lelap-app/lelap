package app.lelap.audio

/** Custom session commands and extras shared by [PlaybackService] and [AudioModule]. */
object Commands {
  const val SET_DUCK = "app.lelap.audio.SET_DUCK"
  const val START_LULL = "app.lelap.audio.START_LULL"
  const val CANCEL_LULL = "app.lelap.audio.CANCEL_LULL"

  const val KEY_ENABLED = "enabled"
  const val KEY_DURATION_MS = "durationMs"

  const val EXTRA_DUCK = "duckOnInterruption"
  const val EXTRA_LULL_END = "lullEndsAtElapsedMs"
}
