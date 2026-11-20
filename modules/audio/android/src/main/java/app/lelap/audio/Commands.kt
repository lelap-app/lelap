package app.lelap.audio

import androidx.media3.session.SessionResult

/** Custom session commands and extras shared by [PlaybackService] and [AudioModule]. */
object Commands {
  /** Why a custom command failed, for JavaScript; null when it succeeded. */
  fun failure(resultCode: Int?, message: String?, fallback: String): String? =
    if (resultCode == SessionResult.RESULT_SUCCESS) null else message?.takeIf { it.isNotBlank() } ?: fallback

  const val SET_SETTINGS = "app.lelap.audio.SET_SETTINGS"
  const val START_SLEEP_TIMER = "app.lelap.audio.START_SLEEP_TIMER"
  const val CANCEL_SLEEP_TIMER = "app.lelap.audio.CANCEL_SLEEP_TIMER"
  const val LOAD_BOOK = "app.lelap.audio.LOAD_BOOK"
  const val UNLOAD = "app.lelap.audio.UNLOAD"
  const val SET_QUEUE = "app.lelap.audio.SET_QUEUE"
  /** The sleep timer button on the notification and lock screen; see [SleepCycle]. */
  const val CYCLE_SLEEP_TIMER = "app.lelap.audio.CYCLE_SLEEP_TIMER"
  /** Casting (M50): play the loaded book on the receiver the cast module connected, or hand back. */
  const val START_CAST = "app.lelap.audio.START_CAST"
  const val STOP_CAST = "app.lelap.audio.STOP_CAST"
  /** M51: count what was heard up to now, so the app can merge it for the right profile. */
  const val SETTLE_ACCOUNTING = "app.lelap.audio.SETTLE_ACCOUNTING"
  /**
   * M74: the widget's Back and Forward. With nothing loaded (the app was closed), the last book is
   * loaded paused at its place first. Named by its value in `modules/widget`'s PlayerRemote.
   */
  const val SKIP = "app.lelap.audio.SKIP"
  /** With [SKIP]: true for forward, false for back. */
  const val KEY_FORWARD = "forward"
  /** With [STOP_CAST]: play on here after the hand-back; missing means as the receiver was. */
  const val KEY_RESUME = "resume"
  const val KEY_QUEUE_JSON = "queue"
  /**
   * M112: with [SET_QUEUE], where in the queue the followed list's next item is (-1: no list). Up
   * Next comes first, so the list's items are the queue's tail from there.
   */
  const val KEY_LIST_NEXT = "listNext"
  /** The notification's, lock screen's and car's Next in list: plays the list's next item now. */
  const val NEXT_IN_LIST = "app.lelap.audio.NEXT_IN_LIST"
  const val PREF_LIST_NEXT = "listNext"
  /** M119: with [SET_QUEUE], the followed [ListPlay] as JSON; empty without a list. */
  const val KEY_LIST_JSON = "list"
  const val PREF_LIST = "listPlay"
  /** The notification's and car's Previous in list: plays the list's item before this one. */
  const val PREVIOUS_IN_LIST = "app.lelap.audio.PREVIOUS_IN_LIST"
  /** In [AUDIO_PREFS]: a list picked in Android Auto, until the app takes it and follows it. */
  const val PREF_LIST_STARTED = "listStarted"
  /** In [AUDIO_PREFS]: the queue, and the books that ended while the app may have been closed. */
  const val PREF_QUEUE = "upNextQueue"
  const val PREF_FINISHED = "finished"
  /** In [AUDIO_PREFS]: the app's [CarSnapshot], the books Android Auto can browse. */
  const val PREF_CAR_LIBRARY = "carLibrary"
  /** In [AUDIO_PREFS]: the [Bedtime] window the app set (absent when off), and the last night it started a timer. */
  const val PREF_BEDTIME = "bedtime"
  const val PREF_BEDTIME_NIGHT = "bedtimeNight"
  /** In [AUDIO_PREFS]: [PlaybackHistory]'s actions made away from the app, until the app takes them (M138). */
  const val PREF_HISTORY = "history"
  /** The notification's and car's Back after a long jump made away from the app; see [BackOffer]. */
  const val GO_BACK = "app.lelap.audio.GO_BACK"
  /** In the app's own controller's connection hints: its commands are logged by the app itself. */
  const val HINT_APP = "lelapApp"
  /** [BedtimeAlarm]'s broadcast to a running service: the bedtime window opens now. */
  const val BEDTIME_NOW = "app.lelap.audio.BEDTIME_NOW"
  /** In [AUDIO_PREFS]: whether the app's diagnostics log is on, and the service's [Diagnostics] events. */
  const val PREF_DIAGNOSTICS = "diagnostics"
  const val PREF_DIAGNOSTIC_LOG = "diagnosticLog"

  const val KEY_SKIP_INTERVAL_MS = "skipIntervalMs"
  const val KEY_SMART_REWIND = "smartRewind"
  /** [SoundChain]'s switches. */
  const val KEY_MONO = "mono"
  const val KEY_VOICE_EQ = "voiceEq"
  const val KEY_VOLUME_BOOST = "volumeBoost"
  /** The listener's defaults for skip silence and even loudness (M84); a book may set its own. */
  const val KEY_SKIP_SILENCE = "skipSilence"
  const val KEY_EVEN_LOUDNESS = "evenLoudness"
  /** Shake the phone near the end of the sleep timer for more time; a setting since M86. */
  const val KEY_SHAKE_TO_EXTEND = "shakeToExtend"
  const val KEY_DURATION_MS = "durationMs"
  /** A [SleepMode]'s wire name; minutes when missing. */
  const val KEY_SLEEP_MODE = "sleepMode"
  const val KEY_BOOK_JSON = "book"
  const val KEY_AUTOPLAY = "autoplay"

  /** Media metadata extra naming the book an item belongs to. */
  const val METADATA_BOOK_ID = "bookId"
  /** Media metadata extras of a live stream (M154): that it is one, and what it plays now. */
  const val METADATA_LIVE = "live"
  const val METADATA_NOW_PLAYING = "nowPlaying"

  /** SharedPreferences file of the service's settings (duck, skip interval, smart rewind, sound). */
  const val AUDIO_PREFS = "lelap_audio"

  /** SharedPreferences file and key of the position journal, read by the app in-process. */
  const val JOURNAL_PREFS = "lelap_journal"
  const val JOURNAL_KEY = "journal"
  /** The book of [JOURNAL_KEY]'s place, written once per load (or change), not with every tick. */
  const val JOURNAL_PLAYLIST_KEY = "journalPlaylist"
  /** Places of books the service replaced by itself (Up Next, Android Auto), oldest first. */
  const val EARLIER_KEY = "earlier"

  /** SharedPreferences file and key of [NowPlaying], and the broadcast sent when it changes. */
  const val NOW_PLAYING_PREFS = "lelap_now_playing"
  const val NOW_PLAYING_KEY = "nowPlaying"
  const val NOW_PLAYING_CHANGED = "app.lelap.audio.NOW_PLAYING_CHANGED"

  /** SharedPreferences file and key of [SilenceSavings], the time skip silence saved per book. */
  const val SILENCE_PREFS = "lelap_silence"
  const val SILENCE_KEY = "saved"

  /** True lowers the volume during calls, false pauses: the meaning it had as a plain switch. */
  const val EXTRA_DUCK = "duckOnInterruption"
  /** 0.2–1; missing in settings saved before it existed, which then duck to 20 %. */
  const val KEY_DUCK_LEVEL = "duckLevel"
  const val EXTRA_WAITING_FOR_FOCUS = "waitingForFocus"
  const val EXTRA_SLEEP_TIMER_END = "sleepTimerEndsAtElapsedMs"
  const val EXTRA_SLEEP_TIMER_FROZEN = "sleepTimerFrozenRemainingMs"
  const val EXTRA_SLEEP_TIMER_MODE = "sleepTimerMode"
}
