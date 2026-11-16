package app.lelap.audio

/** Custom session commands and extras shared by [PlaybackService] and [AudioModule]. */
object Commands {
  const val SET_DUCK = "app.lelap.audio.SET_DUCK"
  const val START_SLEEP_TIMER = "app.lelap.audio.START_SLEEP_TIMER"
  const val CANCEL_SLEEP_TIMER = "app.lelap.audio.CANCEL_SLEEP_TIMER"

  const val KEY_ENABLED = "enabled"
  const val KEY_DURATION_MS = "durationMs"

  const val EXTRA_DUCK = "duckOnInterruption"
  const val EXTRA_SLEEP_TIMER_END = "sleepTimerEndsAtElapsedMs"
  const val EXTRA_SLEEP_TIMER_FROZEN = "sleepTimerFrozenRemainingMs"
}
