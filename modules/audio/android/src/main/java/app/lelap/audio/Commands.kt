package app.lelap.audio

/** Custom session commands and extras shared by [PlaybackService] and [AudioModule]. */
object Commands {
  const val SET_SETTINGS = "app.lelap.audio.SET_SETTINGS"
  const val START_SLEEP_TIMER = "app.lelap.audio.START_SLEEP_TIMER"
  const val CANCEL_SLEEP_TIMER = "app.lelap.audio.CANCEL_SLEEP_TIMER"
  const val LOAD_BOOK = "app.lelap.audio.LOAD_BOOK"
  const val UNLOAD = "app.lelap.audio.UNLOAD"
  const val SET_QUEUE = "app.lelap.audio.SET_QUEUE"
  /** The sleep timer button on the notification and lock screen; see [SleepCycle]. */
  const val CYCLE_SLEEP_TIMER = "app.lelap.audio.CYCLE_SLEEP_TIMER"
  const val KEY_QUEUE_JSON = "queue"
  /** In [AUDIO_PREFS]: the queue, and the books that ended while the app may have been closed. */
  const val PREF_QUEUE = "upNextQueue"
  const val PREF_FINISHED = "finished"
  /** In [AUDIO_PREFS]: the app's [CarSnapshot], the books Android Auto can browse. */
  const val PREF_CAR_LIBRARY = "carLibrary"

  const val KEY_SKIP_INTERVAL_MS = "skipIntervalMs"
  const val KEY_SMART_REWIND = "smartRewind"
  /** [SoundChain]'s switches. */
  const val KEY_MONO = "mono"
  const val KEY_VOICE_EQ = "voiceEq"
  const val KEY_VOLUME_BOOST = "volumeBoost"
  const val KEY_DURATION_MS = "durationMs"
  /** A [SleepMode]'s wire name; minutes when missing. */
  const val KEY_SLEEP_MODE = "sleepMode"
  const val KEY_BOOK_JSON = "book"
  const val KEY_AUTOPLAY = "autoplay"

  /** Media metadata extra naming the book an item belongs to. */
  const val METADATA_BOOK_ID = "bookId"

  /** SharedPreferences file of the service's settings (duck, skip interval, smart rewind, sound). */
  const val AUDIO_PREFS = "lelap_audio"

  /** SharedPreferences file and key of the position journal, read by the app in-process. */
  const val JOURNAL_PREFS = "lelap_journal"
  const val JOURNAL_KEY = "journal"
  /** Places of books the service replaced by itself (Up Next, Android Auto), oldest first. */
  const val EARLIER_KEY = "earlier"

  /** SharedPreferences file and key of [NowPlaying], and the broadcast sent when it changes. */
  const val NOW_PLAYING_PREFS = "lelap_now_playing"
  const val NOW_PLAYING_KEY = "nowPlaying"
  const val NOW_PLAYING_CHANGED = "app.lelap.audio.NOW_PLAYING_CHANGED"

  const val EXTRA_DUCK = "duckOnInterruption"
  const val EXTRA_WAITING_FOR_FOCUS = "waitingForFocus"
  const val EXTRA_SLEEP_TIMER_END = "sleepTimerEndsAtElapsedMs"
  const val EXTRA_SLEEP_TIMER_FROZEN = "sleepTimerFrozenRemainingMs"
  const val EXTRA_SLEEP_TIMER_MODE = "sleepTimerMode"
}
