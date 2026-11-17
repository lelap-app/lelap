package app.lelap.audio

/** Custom session commands and extras shared by [PlaybackService] and [AudioModule]. */
object Commands {
  const val SET_SETTINGS = "app.lelap.audio.SET_SETTINGS"
  const val START_SLEEP_TIMER = "app.lelap.audio.START_SLEEP_TIMER"
  const val CANCEL_SLEEP_TIMER = "app.lelap.audio.CANCEL_SLEEP_TIMER"
  const val LOAD_BOOK = "app.lelap.audio.LOAD_BOOK"
  const val UNLOAD = "app.lelap.audio.UNLOAD"
  const val SET_QUEUE = "app.lelap.audio.SET_QUEUE"
  const val KEY_QUEUE_JSON = "queue"
  /** In [AUDIO_PREFS]: the queue, and the books that ended while the app may have been closed. */
  const val PREF_QUEUE = "upNextQueue"
  const val PREF_FINISHED = "finished"

  const val KEY_SKIP_INTERVAL_MS = "skipIntervalMs"
  const val KEY_SMART_REWIND = "smartRewind"
  const val KEY_DURATION_MS = "durationMs"
  const val KEY_BOOK_JSON = "book"
  const val KEY_AUTOPLAY = "autoplay"

  /** Media metadata extra naming the book an item belongs to. */
  const val METADATA_BOOK_ID = "bookId"

  /** SharedPreferences file of the service's settings (duck, skip interval, smart rewind). */
  const val AUDIO_PREFS = "lelap_audio"

  /** SharedPreferences file and key of the position journal, read by the app in-process. */
  const val JOURNAL_PREFS = "lelap_journal"
  const val JOURNAL_KEY = "journal"

  const val EXTRA_DUCK = "duckOnInterruption"
  const val EXTRA_WAITING_FOR_FOCUS = "waitingForFocus"
  const val EXTRA_SLEEP_TIMER_END = "sleepTimerEndsAtElapsedMs"
  const val EXTRA_SLEEP_TIMER_FROZEN = "sleepTimerFrozenRemainingMs"
}
