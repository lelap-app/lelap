package app.lelap.audio

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.PlayerMessage
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import app.lelap.netfs.NetDataSource
import app.lelap.netfs.NetFailure
import app.lelap.netfs.Netfs
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import app.lelap.text.NativeText
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import app.lelap.cast.CastLink
import app.lelap.cast.CastRequest
import app.lelap.cast.RendererStatus
import java.util.TimeZone
import org.json.JSONArray
import org.json.JSONObject

private const val TIMER_TICK_MS = 250L
private const val CHAPTER_TICK_MS = 1_000L
// A chapter or episode timer's end moves with seeks and speed; the app hears it this often.
private const val BOUNDARY_PUBLISH_TICKS = 20
// How long the sensor may hold accelerometer samples before handing them over; a shake answers
// this much later at most.
private const val SHAKE_BATCH_US = 200_000

@OptIn(UnstableApi::class)
private const val PAUSE_SETTLE_MS = 500L

// The emulator smoke test waits for this tag's "Playing" line (scripts/emulator-smoke.sh).
private const val TAG = "LelapPlayback"

class PlaybackService : MediaLibraryService() {
  private lateinit var player: ExoPlayer
  private lateinit var session: MediaLibrarySession
  private lateinit var focus: AudioFocus
  private lateinit var mixer: VolumeMixer
  private lateinit var sleepTimer: SleepTimer
  private lateinit var rules: PlaybackRules
  private lateinit var port: Port

  // While casting (M50): the session's player, the link it plays through, and the app's wait for
  // the first file to load. ExoPlayer keeps the book, paused, for the hand-back.
  private var remote: RemotePlayer? = null
  private var remoteLink: CastLink? = null
  private var castStart: SettableFuture<SessionResult>? = null

  /** The player the listener hears: the receiver while casting, else ExoPlayer. */
  private val active: Player
    get() = remote ?: player

  // A chapter or episode timer: where on the book timeline it stops, and the message that stops
  // playback there exactly.
  private var sleepBoundaryMs: Long? = null
  private var boundaryMessage: PlayerMessage? = null
  // A podcast's outro (M45): the message that ends the episode where its outro starts.
  private var outroMessage: PlayerMessage? = null
  private var ticksSincePublish = 0

  // The step the notification's sleep timer button last started, and the button's last state.
  private var sleepPressed: SleepStep? = null
  private var sleepButtonStep: SleepStep? = null
  private var buttonsSkipMs = 0L
  private var lastNowPlaying: String? = null

  private val sensors by lazy { getSystemService(SENSOR_SERVICE) as SensorManager }
  private val shake = ShakeDetector(SystemClock::elapsedRealtime)
  private var listeningForShake = false
  private var shakeToExtend = true
  private val shakeListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent) {
      val (x, y, z) = event.values
      // Batched samples arrive together; the sensor's own time keeps their spacing.
      val atMs = event.timestamp / 1_000_000L
      if (sleepTimer.acceptsShake && shake.onSample(x, y, z, atMs)) extendSleepTimer()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  }

  private val handler = Handler(Looper.getMainLooper())
  private val sound = SoundChain()
  private val silence = SilenceTally(SilenceRules.processor())
  // Each part's ReplayGain, handed from the sink to the processor on the playback thread (M101).
  private val gains = StreamGains()
  private val soundChain = SoundAudioProcessorChain(SoundProcessor(sound, silence, gains), silence)
  // The listener's voice boost, skip silence and even loudness (M84); a book may set its own.
  private var soundDefaults = SoundChoice()
  private val silencePrefs by lazy { getSharedPreferences(Commands.SILENCE_PREFS, MODE_PRIVATE) }
  private val savings by lazy { SilenceSavings.decode(silencePrefs.getString(Commands.SILENCE_KEY, null)) }
  private val prefs by lazy { getSharedPreferences(Commands.AUDIO_PREFS, MODE_PRIVATE) }
  private val journalPrefs by lazy { getSharedPreferences(Commands.JOURNAL_PREFS, MODE_PRIVATE) }
  // The playlist last written beside the journal's place; ticks write the place alone.
  private var journaledPlaylist: BookPlaylist? = null

  /** The loaded book, kept for the journal and playback resumption. */
  private var current: BookPlaylist? = null
    set(value) {
      val sameFiles = value != null && field?.files == value.files && field?.headers == value.headers
      // The playback thread counts skipped silence per book and starts each book's loudness
      // afresh at its first stream (M101); a book switch only banks what it counted.
      if (field?.bookId != value?.bookId) bankSilence()
      field = value
      applySound()
      if (sameFiles) return
      // Only this book's own files get its server's login, never another host.
      headersByUri = value?.takeIf { it.headers.isNotEmpty() }
        ?.let { book -> book.files.associate { file -> file.uri to book.headers } }
        .orEmpty()
    }

  @Volatile private var headersByUri: Map<String, Map<String, String>> = emptyMap()

  // Media3 sends the same headers after a redirect, to any host, so a file with a login is read
  // by LoginDataSource, which follows the redirects of every request itself (M100). SMB and SFTP
  // have no redirects; their login only ever reaches native code.
  private fun withBookHeaders(upstream: DataSource.Factory): DataSource.Factory = DataSource.Factory {
    BookFileDataSource(upstream.createDataSource(), { uri -> headersByUri[uri] }, Netfs::handles)
  }
  private var currentHandsOver = false

  // The app writes the car snapshot straight into the preferences; Android Auto then re-reads it.
  private val carListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
    if (key == Commands.PREF_CAR_LIBRARY && ::session.isInitialized) {
      for (shelf in CarLibrary.children(CarLibrary.ROOT, CarSnapshot(), null).orEmpty()) {
        session.notifyChildrenChanged(shelf.id, Int.MAX_VALUE, null)
      }
    }
  }
  // The profile's language changed (modules/text): rename the buttons and the car's shelves.
  private val languageReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (!::session.isInitialized) return
      sleepButtonStep = null
      updateSleepButton()
      session.notifyChildrenChanged(CarLibrary.ROOT, Int.MAX_VALUE, null)
      setMediaNotificationProvider(notificationProvider())
      triggerNotificationUpdate()
    }
  }
  // The bedtime window opens now (BedtimeAlarm): a book already playing gets the routine. A new
  // clock time or time zone moves the window's next start.
  private val bedtimeReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      BedtimeAlarm.schedule(context)
      if (intent.action != Commands.BEDTIME_NOW) return
      if (::session.isInitialized && active.playWhenReady) startBedtimeTimer()
    }
  }
  // The routine changed while its volume applies (turned off, a new volume, another profile's).
  private val bedtimeListener = SharedPreferences.OnSharedPreferenceChangeListener { p, key ->
    if (key != Commands.PREF_BEDTIME || !::mixer.isInitialized || mixer.bedtime >= 1f) return@OnSharedPreferenceChangeListener
    mixer.bedtime = Bedtime.decode(p.getString(Commands.PREF_BEDTIME, null))?.gain ?: 1f
  }

  // The listener's last touch of the player (M86): the last moment they surely were awake, offered
  // when the sleep timer stops playback. Only their own commands count, never auto-advance.
  private var lastInteraction: PlaceMark? = null

  private var queue: List<BookLoad> = emptyList()
  /** Where the followed list's next item is in [queue]; -1 without a list (M112). */
  private var listNext = -1
  private var buttonsListNext: Boolean? = null

  private var skipIntervalMs = 30_000L
  private var smartRewind = true

  /** Wall-clock time of the last pause, for smart rewind; null once Play has used it. */
  private var pausedAt: Long? = null

  // When playback or a seek last moved the place. Loading a book does not move it, so the journal
  // carries this time rather than the write time: a stale place loaded here must not outrank a
  // newer one synced from another device.
  private var placeChangedAt = 0L

  // Listening time and scrobble sessions (M51), counted here so they keep counting with the app
  // closed; the app takes them from [Accounting] when it wakes.
  private val tally = ListeningTally(dayOf = { wall -> LocalDay.key(wall, TimeZone.getDefault().getOffset(wall)) })
  // While the book moves between ExoPlayer and a receiver, the paused or stale player in between
  // is not what the listener hears: no pause, and no place from it.
  private var handingOver = false

  private val chapterTicker = object : Runnable {
    override fun run() {
      updateChapterTitle()
      if (active.isPlaying) handler.postDelayed(this, CHAPTER_TICK_MS)
    }
  }

  // ExoPlayer reports the pause before its position settles (about 1.7 s early on the test phone),
  // so the journal is written once more shortly after.
  private val pauseSettled = Runnable {
    if (!active.isPlaying) writeJournal(PositionJournal.Event.PAUSE)
  }

  private val journalTicker = object : Runnable {
    override fun run() {
      placeChangedAt = System.currentTimeMillis()
      account()
      bankSilence()
      writeJournal(PositionJournal.Event.TICK)
    }
  }

  private val timerTicker = object : Runnable {
    override fun run() {
      sleepTimer.tick()
      updateShakeListening()
      if (sleepBoundaryMs != null && ++ticksSincePublish >= BOUNDARY_PUBLISH_TICKS) publishExtras()
      if (sleepTimer.isRunning) handler.postDelayed(this, TIMER_TICK_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    val http = DefaultHttpDataSource.Factory()
      .setUserAgent("Lelap")
      // archive.org redirects downloads to mirror hosts, sometimes across protocols.
      .setAllowCrossProtocolRedirects(true)
    player = ExoPlayer.Builder(this, SoundRenderersFactory(this, soundChain, gains))
      .setMediaSourceFactory(
        DefaultMediaSourceFactory(withBookHeaders(NetDataSource.Factory(DefaultDataSource.Factory(this, http))))
          .setLoadErrorHandlingPolicy(
            ExpiringLinkPolicy { status -> handler.post { note(Diagnostics.LINK_REFRESHED, status = status) } },
          ),
      )
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
          .build(),
        /* handleAudioFocus= */ false,
      )
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()

    mixer = VolumeMixer { player.volume = it }
    sleepTimer = SleepTimer(
      clock = SystemClock::elapsedRealtime,
      onVolume = {
        mixer.fade = it
        remote?.setFade(it)
      },
      onFinished = {
        keepSleepPlace()
        clearBoundary()
        // A receiver is paused straight away; it holds no audio focus to give up.
        val r = remote
        if (r != null) r.pause() else rules.onSleepTimerFinished()
        // The routine's quieter volume ends with its timer; the next Play is at full volume.
        mixer.bedtime = 1f
        publishExtras()
      },
    )
    focus = AudioFocus(this) {
      Diagnostics.focusEvent(it)?.let { what -> note(what) }
      rules.onFocus(it)
      publishExtras()
    }
    port = Port()
    rules = PlaybackRules(port).apply {
      interruption = interruptionOf(prefs.getBoolean(Commands.EXTRA_DUCK, true))
      duckLevel = duckLevelOf(
        if (prefs.contains(Commands.KEY_DUCK_LEVEL)) prefs.getFloat(Commands.KEY_DUCK_LEVEL, DEFAULT_DUCK_LEVEL) else null,
      )
    }
    skipIntervalMs = prefs.getLong(Commands.KEY_SKIP_INTERVAL_MS, 30_000L)
    smartRewind = prefs.getBoolean(Commands.KEY_SMART_REWIND, true)
    shakeToExtend = prefs.getBoolean(Commands.KEY_SHAKE_TO_EXTEND, true)
    sound.mono = prefs.getBoolean(Commands.KEY_MONO, false)
    sound.boost = prefs.getBoolean(Commands.KEY_VOLUME_BOOST, false)
    soundDefaults = SoundChoice(
      voiceEq = prefs.getBoolean(Commands.KEY_VOICE_EQ, false),
      skipSilence = prefs.getBoolean(Commands.KEY_SKIP_SILENCE, false),
      evenLoudness = prefs.getBoolean(Commands.KEY_EVEN_LOUDNESS, false),
    )
    applySound()
    focus.interruption = rules.interruption
    queue = UpNext.decodeQueue(prefs.getString(Commands.PREF_QUEUE, null))
    listNext = prefs.getInt(Commands.PREF_LIST_NEXT, -1).takeIf { it in queue.indices } ?: -1
    Accounting.edit(this) { tally.recover(it) }
    player.addListener(object : Player.Listener {
      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        Diagnostics.pauseEvent(playWhenReady, reason)?.let { note(it, code = reason) }
        if (remote == null) account()
        if (playWhenReady) rewindAfterPause() else pausedAt = System.currentTimeMillis()
        rules.onPlayWhenReadyChanged(playWhenReady)
        if (playWhenReady) startBedtimeTimer()
        publishExtras()
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        // While casting the receiver's place is the one kept.
        if (remote == null) onPlayingChanged(isPlaying)
      }

      override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_ENDED) onBookEnded()
      }

      override fun onPlayerError(error: PlaybackException) {
        val status = generateSequence<Throwable>(error) { it.cause }
          .filterIsInstance<HttpDataSource.InvalidResponseCodeException>()
          .firstOrNull()?.responseCode
        note(Diagnostics.ERROR, code = error.errorCode, status = status)
      }

      // New items, or their real durations once known: the outro is found from the last one.
      override fun onTimelineChanged(timeline: Timeline, reason: Int) = placeOutro()

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        if (remote == null) onItemTransition(reason)
      }

      override fun onPositionDiscontinuity(
        oldPosition: Player.PositionInfo,
        newPosition: Player.PositionInfo,
        reason: Int,
      ) {
        if (remote == null) onDiscontinuity(oldPosition, newPosition, reason)
      }

      override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
        if (remote == null) {
          account()
          // Any controller may change the speed; resuming from the journal must use the new one.
          current?.let { current = PositionJournal.withSpeed(it, playbackParameters.speed) }
          writeJournal(PositionJournal.Event.SPEED)
        }
        if (sleepBoundaryMs != null) publishExtras()
      }

      override fun onEvents(player: Player, events: Player.Events) = publishNowPlaying()
    })

    val builder = MediaLibrarySession.Builder(this, SkippingPlayer(), Callback())
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setSessionActivity(
        PendingIntent.getActivity(
          this,
          0,
          launch,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ),
      )
    }
    // Media3 creates its notification channel only when there is none, so this one keeps our name.
    NativeText.channel(
      this,
      DefaultMediaNotificationProvider.DEFAULT_CHANNEL_ID,
      "Now playing",
      NotificationManager.IMPORTANCE_LOW,
    )
    setMediaNotificationProvider(notificationProvider())
    session = builder.build()
    prefs.registerOnSharedPreferenceChangeListener(carListener)
    ContextCompat.registerReceiver(
      this,
      languageReceiver,
      IntentFilter(NativeText.CHANGED),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    ContextCompat.registerReceiver(
      this,
      bedtimeReceiver,
      IntentFilter(Commands.BEDTIME_NOW).apply {
        addAction(Intent.ACTION_TIME_CHANGED)
        addAction(Intent.ACTION_TIMEZONE_CHANGED)
      },
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    prefs.registerOnSharedPreferenceChangeListener(bedtimeListener)
    // After a reboot the alarm is gone until the service or the app starts again.
    BedtimeAlarm.schedule(this)
    publishExtras()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

  /**
   * Media3 reads its play and pause descriptions from resources as it draws, in the context's
   * language; this one has the profile's, and a new one is made on a switch.
   */
  private fun notificationProvider() = DefaultMediaNotificationProvider.Builder(NativeText.localized(this)).build()

  override fun onTaskRemoved(rootIntent: Intent?) {
    account(durable = true)
    writeJournal(PositionJournal.Event.TASK_REMOVED)
    // Keep playing (here or on a receiver) when the app is swiped away; nothing to keep alive when paused.
    if (!active.playWhenReady || player.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    account()
    bankSilence()
    writeJournal(PositionJournal.Event.DESTROY)
    endRemote(resume = false)
    // Nothing plays after this: the scrobble session ends here rather than at the next start.
    account(observed = null, durable = true)
    publishNowPlaying(stopping = true)
    handler.removeCallbacks(journalTicker)
    handler.removeCallbacks(chapterTicker)
    handler.removeCallbacks(timerTicker)
    handler.removeCallbacks(pauseSettled)
    sleepTimer.cancel()
    clearBoundary()
    stopShakeListening()
    prefs.unregisterOnSharedPreferenceChangeListener(carListener)
    unregisterReceiver(languageReceiver)
    unregisterReceiver(bedtimeReceiver)
    prefs.unregisterOnSharedPreferenceChangeListener(bedtimeListener)
    focus.abandon()
    session.release()
    player.release()
    super.onDestroy()
  }

  /**
   * Voice boost, skip silence and even loudness for the loaded book: its own choices over the
   * listener's defaults (M84). They act on ExoPlayer only; a cast receiver plays without them.
   */
  private fun applySound() {
    if (!::player.isInitialized) return
    val choice = soundDefaults.with(current?.sound)
    sound.voiceEq = choice.voiceEq
    sound.evenLoudness = choice.evenLoudness
    if (player.skipSilenceEnabled != choice.skipSilence) player.skipSilenceEnabled = choice.skipSilence
  }

  /** Adds what skip silence left out since the last call to each book's time saved. */
  private fun bankSilence() {
    if (!::player.isInitialized) return
    val skipped = silence.takeSkippedUs()
    if (skipped.isEmpty()) return
    for ((bookId, us) in skipped) savings.add(bookId, us, player.playbackParameters.speed)
    silencePrefs.edit().putString(Commands.SILENCE_KEY, savings.encode()).apply()
  }

  /** The book played to its end: log it, then hand over to Up Next if it is an episode. */
  private fun onBookEnded() {
    val ended = current ?: return
    // The session that reached the end, for the finish scrobble's start (M102).
    val start = try {
      Accounting.edit(this) { it.sessionStartOf(ended.bookId) }
    } catch (e: Exception) {
      null
    }
    val log = UpNext.decodeFinished(prefs.getString(Commands.PREF_FINISHED, null)) +
      Finished(ended.bookId, System.currentTimeMillis(), start?.first, start?.second)
    prefs.edit().putString(Commands.PREF_FINISHED, UpNext.encodeFinished(log.takeLast(100))).apply()
    // A timer for the end of the episode (or of the last chapter) stops here, before Up Next.
    if (sleepBoundaryMs != null) {
      sleepTimer.finish()
      return
    }
    val (next, rest) = UpNext.afterEnd(currentHandsOver, queue)
    if (next == null) return
    saveQueue(rest, UpNext.listNextAfterHead(listNext, rest))
    loadBook(next, autoplay = true)
  }

  /** Next in list (M112): the list's next item now, playing if this one was. */
  private fun skipToListNext() {
    val (next, rest, after) = UpNext.skipToListNext(listNext, queue)
    if (next == null) return
    val play = active.playWhenReady
    saveQueue(rest, after)
    loadBook(next, autoplay = play)
    noteInteraction()
  }

  private fun saveQueue(list: List<BookLoad>, nextInList: Int) {
    queue = list
    listNext = nextInList
    prefs.edit()
      .putString(Commands.PREF_QUEUE, encodeQueue(list))
      .putInt(Commands.PREF_LIST_NEXT, nextInList)
      .apply()
    updateSleepButton()
  }

  /** Adds an event to the diagnostics log, only while the app has the log on. */
  private fun note(what: String, code: Int? = null, status: Int? = null) {
    if (!prefs.getBoolean(Commands.PREF_DIAGNOSTICS, false)) return
    val entry = DiagnosticEntry(
      at = System.currentTimeMillis(),
      what = what,
      code = code,
      status = status,
      bookId = current?.bookId,
      part = if (player.mediaItemCount > 0) player.currentMediaItemIndex else null,
    )
    prefs.edit().putString(
      Commands.PREF_DIAGNOSTIC_LOG,
      Diagnostics.append(prefs.getString(Commands.PREF_DIAGNOSTIC_LOG, null), entry),
    ).apply()
  }

  private fun encodeQueue(list: List<BookLoad>): String =
    JSONArray(list.map { JSONObject(PositionJournal.encodeLoad(it)) }).toString()

  private fun loadBook(load: BookLoad, autoplay: Boolean) {
    val playlist = load.playlist
    // The book that is already loaded keeps its live place, which is newer than any saved one.
    val loaded = current
    if (loaded != null && PositionJournal.isSameBook(loaded, player.mediaItemCount, load)) {
      // Also an update: a list that starts or stops playing changes it (M112).
      currentHandsOver = load.handsOver
      if (PositionJournal.filesChanged(loaded, playlist)) {
        switchFiles(load, autoplay)
        return
      }
      // A changed intro or outro for the show, or chapters found from silences, apply to the
      // book that is loaded, at its live place.
      // The book's or show's own sound changed: it applies at once, at the live place.
      if (loaded.sound != playlist.sound) current = loaded.copy(sound = playlist.sound)
      if (loaded.introMs != playlist.introMs || loaded.outroMs != playlist.outroMs || loaded.chapters != playlist.chapters ||
        loaded.artworks != playlist.artworks || loaded.coverUri != playlist.coverUri
      ) {
        current = (current ?: loaded).copy(
          introMs = playlist.introMs,
          outroMs = playlist.outroMs,
          chapters = playlist.chapters,
          artworks = playlist.artworks,
          coverUri = playlist.coverUri,
        )
        placeOutro()
        remote?.setOutro(remoteOutroAt())
        updateChapterTitle()
        // A chapter timer moves to the end of the chapter playing now.
        if (sleepBoundaryMs != null) placeBoundary()
        writeJournal(PositionJournal.Event.ITEM_CHANGE)
      }
      if (autoplay) active.play()
      return
    }
    // The service moved on to another book by itself since the app asked: its hand-over stays.
    if (load.onlyIfLoaded) return
    currentHandsOver = load.handsOver
    if (!autoplay) player.pause()
    keepEarlierPlace(playlist.bookId)
    account()
    current = playlist
    val start = load.startPositionMs.coerceAtLeast(0L)
    val index = load.startIndex.coerceIn(0, playlist.files.lastIndex)
    val position = SeekRules.startPosition(
      index,
      start,
      if (autoplay) load.pausedAt else null,
      System.currentTimeMillis(),
      smartRewind,
      playlist.introMs,
    )
    pausedAt = if (autoplay) null else load.pausedAt
    placeChangedAt = load.pausedAt ?: 0L
    val items = mediaItems(playlist)
    player.setMediaItems(items, index, position)
    player.setPlaybackSpeed(playlist.speed.coerceIn(0.5f, 3f))
    // While casting the book (or the next in Up Next) goes to the same receiver; ExoPlayer only
    // keeps it for the hand-back, so it fetches nothing meanwhile.
    val r = remote
    if (r == null) player.prepare()
    r?.setBook(items, timelineDurations(), index, position, playlist.speed.coerceIn(0.5f, 3f), autoplay, remoteOutroAt())
    // A chapter timer carries over to the new book's chapter.
    placeBoundary()
    if (autoplay && r == null) player.play()
    writeJournal(PositionJournal.Event.ITEM_CHANGE)
  }

  /**
   * The loaded book's files have other addresses now (a download finished, was removed or moved
   * to another folder): it plays on from them at its live place, so nothing reads deleted files.
   */
  private fun switchFiles(load: BookLoad, autoplay: Boolean) {
    val p = active
    val live = load.playlist.files.indexOfFirst { it.location == p.currentMediaItem?.mediaId }
    val index = if (live >= 0) live else load.startIndex.coerceIn(0, load.playlist.files.lastIndex)
    val position = if (live >= 0) p.currentPosition else load.startPositionMs.coerceAtLeast(0L)
    val play = autoplay || p.playWhenReady
    // The live speed: a controller may have changed it since the app last saved it.
    val playlist = PositionJournal.withSpeed(load.playlist, current?.speed ?: load.playlist.speed)
    current = playlist
    val items = mediaItems(playlist)
    player.setMediaItems(items, index, position)
    val r = remote
    if (r == null) {
      player.prepare()
      if (play) player.play()
    } else {
      r.setBook(items, timelineDurations(), index, position, playlist.speed, play, remoteOutroAt())
    }
    placeBoundary()
    writeJournal(PositionJournal.Event.ITEM_CHANGE)
  }

  /**
   * Before the service replaces the book by itself (Up Next, Android Auto), keeps its place in a
   * list the app folds in, since the journal only holds the book that plays now.
   */
  private fun keepEarlierPlace(nextBookId: String) {
    val playing = current ?: return
    if (playing.bookId == nextBookId) return
    writeJournal(PositionJournal.Event.ITEM_CHANGE)
    val entry = PositionJournal.decodeEntry(journalPrefs.getString(Commands.JOURNAL_KEY, null)) ?: return
    if (entry.bookId != playing.bookId) return
    journalPrefs.edit()
      .putString(Commands.EARLIER_KEY, PositionJournal.appendEarlier(journalPrefs.getString(Commands.EARLIER_KEY, null), entry))
      .apply()
  }

  /**
   * Another profile is listening and has nothing loaded: headphones and the car must not resume
   * the last profile's book. Its place stays, for the app to fold into that profile.
   */
  private fun forgetJournaledBook() {
    val entry = PositionJournal.decodeEntry(journalPrefs.getString(Commands.JOURNAL_KEY, null))
    val editor = journalPrefs.edit().remove(Commands.JOURNAL_PLAYLIST_KEY)
    // Rewritten alone: the older form carried its playlist inside the place.
    entry?.let { editor.putString(Commands.JOURNAL_KEY, PositionJournal.encodeEntry(it)) }
    editor.apply()
    journaledPlaylist = null
  }

  private fun carSnapshot(): CarSnapshot = CarLibrary.decode(prefs.getString(Commands.PREF_CAR_LIBRARY, null))

  private fun journaled(): Pair<JournalEntry, BookPlaylist>? = PositionJournal.decode(
    journalPrefs.getString(Commands.JOURNAL_KEY, null),
    journalPrefs.getString(Commands.JOURNAL_PLAYLIST_KEY, null),
  )

  private fun journalLoad(): BookLoad? = journaled()?.let { (entry, playlist) -> CarLibrary.journalLoad(entry, playlist) }

  private fun carItem(node: CarNode): MediaItem = MediaItem.Builder()
    .setMediaId(node.id)
    .setMediaMetadata(
      MediaMetadata.Builder()
        .setTitle(node.title)
        .setArtist(node.subtitle)
        .setArtworkUri(node.artworkUri?.let(Uri::parse))
        .setIsBrowsable(node.browsable)
        .setIsPlayable(node.playable)
        .apply { if (node.browsable) setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED) }
        .build(),
    )
    .build()

  /** A book picked in Android Auto, loaded like the app loads one and played from its place. */
  private fun carPlay(load: BookLoad): MediaSession.MediaItemsWithStartPosition {
    val playlist = load.playlist
    if (PositionJournal.isSameBook(current, player.mediaItemCount, load)) {
      currentHandsOver = load.handsOver
      return MediaSession.MediaItemsWithStartPosition(
        mediaItems(playlist),
        active.currentMediaItemIndex,
        active.currentPosition,
      )
    }
    keepEarlierPlace(playlist.bookId)
    account()
    current = playlist
    currentHandsOver = load.handsOver
    // A book picked in the car plays on its own; Next in list leaves until the app sends a list.
    if (listNext >= 0) saveQueue(queue, -1)
    pausedAt = null
    placeChangedAt = load.pausedAt ?: 0L
    player.setPlaybackSpeed(playlist.speed.coerceIn(0.5f, 3f))
    val index = load.startIndex.coerceIn(0, playlist.files.lastIndex)
    val start = SeekRules.startPosition(
      index,
      load.startPositionMs.coerceAtLeast(0L),
      load.pausedAt,
      System.currentTimeMillis(),
      smartRewind,
      playlist.introMs,
    )
    // The session sets the items after this returns; a chapter timer then finds the new chapter.
    handler.post { placeBoundary() }
    return MediaSession.MediaItemsWithStartPosition(mediaItems(playlist), index, start)
  }

  private fun mediaItems(playlist: BookPlaylist): List<MediaItem> = playlist.files.mapIndexed { index, file ->
    val uri = Uri.parse(file.uri)
    MediaItem.Builder()
      .setMediaId(file.location)
      .setUri(uri)
      .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(chapterTitleAt(playlist, index, 0L) ?: file.title)
          .setAlbumTitle(playlist.title)
          .setArtist(playlist.author)
          .setArtworkUri(ChapterArtwork.at(playlist, index, 0L)?.let(Uri::parse))
          .setTrackNumber(index + 1)
          .setTotalTrackCount(playlist.files.size)
          .setExtras(Bundle().apply { putString(Commands.METADATA_BOOK_ID, playlist.bookId) })
          .build(),
      )
      .build()
  }

  private fun rewindAfterPause() {
    if (player.mediaItemCount == 0) return
    val p = active
    val index = p.currentMediaItemIndex
    rewoundPlace(index, p.currentPosition)?.let { p.seekTo(index, it) }
  }

  /**
   * Where Play resumes the file at [index] after a pause, with smart rewind; null to play on. Uses
   * up the pause, so it rewinds once.
   */
  private fun rewoundPlace(index: Int, position: Long): Long? {
    val since = pausedAt ?: return null
    pausedAt = null
    if (!smartRewind) return null
    val rewind = SeekRules.rewindOnResume(System.currentTimeMillis() - since)
    if (rewind <= 0) return null
    // Never across a file start, and not back into a skipped intro once past it; a listener who
    // went back into the intro on purpose stays there.
    val intro = current?.introMs?.takeIf { position >= it } ?: 0L
    return SeekRules.trimmedStart(index, position, rewind, intro)
  }

  /** Where the outro starts in the last file, for a receiver, which has no player messages. */
  private fun remoteOutroAt(): Long? {
    val playlist = current ?: return null
    val durations = timelineDurations()
    val last = durations.lastIndex
    if (last < 0 || playlist.outroMs <= 0) return null
    return SeekRules.outroStart(durations[last], playlist.outroMs, playlist.introMs, last == 0)
  }

  /** Ends the episode where its outro starts, by a message at that place in the last file. */
  private fun placeOutro() {
    outroMessage?.cancel()
    outroMessage = null
    val playlist = current ?: return
    val last = player.mediaItemCount - 1
    if (last < 0 || playlist.outroMs <= 0) return
    val at = SeekRules.outroStart(durations().getOrElse(last) { 0L }, playlist.outroMs, playlist.introMs, last == 0)
      ?: return
    // Kept after delivery: a listener who goes back before the outro has it skipped again. One
    // who seeks past the place hears the outro, since playback never crosses it.
    outroMessage = player.createMessage { _, _ -> skipOutro(last) }
      .setLooper(Looper.getMainLooper())
      .setPosition(last, at)
      .setDeleteAfterDelivery(false)
      .send()
  }

  /** At the end of the last file the player ends the book: logged as played, then Up Next. */
  private fun skipOutro(last: Int) {
    if (player.mediaItemCount - 1 != last || player.currentMediaItemIndex != last) return
    val end = durations().getOrElse(last) { 0L }
    if (end > 0) player.seekTo(last, end)
  }

  /** Durations the player knows, else those from the tags. */
  private fun durations(): List<Long> = List(player.mediaItemCount) { i ->
    val known = player.currentTimeline.takeIf { i < it.windowCount }?.getWindow(i, Timeline.Window())?.durationMs
    if (known != null && known != C.TIME_UNSET) known else current?.files?.getOrNull(i)?.durationMs ?: 0L
  }

  /** Back or forward by [deltaMs]: always the listener's own press (a controller or the widget). */
  private fun skipBy(deltaMs: Long) {
    if (player.mediaItemCount == 0) return
    val (index, position) = SeekRules.skip(active.currentMediaItemIndex, active.currentPosition, deltaMs, durations())
    active.seekTo(index, position)
    noteInteraction()
  }

  private fun chapterTitleAt(playlist: BookPlaylist, index: Int, positionMs: Long): String? {
    if (playlist.chapters.isEmpty()) return null
    val bookPosition = playlist.files.take(index).sumOf { it.durationMs.coerceAtLeast(0L) } + positionMs
    return playlist.chapters.lastOrNull { it.startMs <= bookPosition }?.title
  }

  /**
   * Shows the current chapter as the title on the notification and lock screen, with the chapter's
   * picture from an episode's chapters file (M103), which the car shows too.
   */
  private fun updateChapterTitle() {
    val playlist = current ?: return
    val p = active
    val index = p.currentMediaItemIndex
    val item = p.currentMediaItem ?: return
    val position = p.currentPosition
    val title = chapterTitleAt(playlist, index, position) ?: item.mediaMetadata.title?.toString()
    val artwork = ChapterArtwork.at(playlist, index, position)?.let(Uri::parse)
    if (item.mediaMetadata.title?.toString() == title && item.mediaMetadata.artworkUri == artwork) return
    // Same URI, so ExoPlayer swaps the metadata without interrupting playback.
    val metadata = item.mediaMetadata.buildUpon().setTitle(title).setArtworkUri(artwork).build()
    p.replaceMediaItem(index, item.buildUpon().setMediaMetadata(metadata).build())
  }

  /**
   * The session's player, ExoPlayer or the receiver: previous and next skip by the skip interval,
   * across files. Every controller goes through it (the app, the notification, the lock screen,
   * headphones, watches and cars), while the service's own moves (smart rewind, the timer's stop,
   * the next part) use the players directly. So its commands are the listener's touches.
   */
  private inner class SkippingPlayer(private val base: Player = player) : ForwardingPlayer(base) {
    private fun touched(command: () -> Unit) {
      command()
      noteInteraction()
    }

    override fun play() = touched { super.play() }
    override fun pause() = touched { super.pause() }
    override fun setPlayWhenReady(playWhenReady: Boolean) = touched { super.setPlayWhenReady(playWhenReady) }
    override fun seekTo(positionMs: Long) = touched { super.seekTo(positionMs) }
    override fun seekTo(mediaItemIndex: Int, positionMs: Long) = touched { super.seekTo(mediaItemIndex, positionMs) }
    override fun seekToDefaultPosition() = touched { super.seekToDefaultPosition() }
    override fun seekToDefaultPosition(mediaItemIndex: Int) = touched { super.seekToDefaultPosition(mediaItemIndex) }
    override fun setPlaybackSpeed(speed: Float) = touched { super.setPlaybackSpeed(speed) }
    override fun setPlaybackParameters(playbackParameters: PlaybackParameters) =
      touched { super.setPlaybackParameters(playbackParameters) }

    private val skipCommands = intArrayOf(
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_NEXT,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD,
    )

    override fun getAvailableCommands(): Player.Commands {
      val commands = super.getAvailableCommands()
      if (base.mediaItemCount == 0) return commands
      return commands.buildUpon().addAll(*skipCommands).build()
    }

    val increments = SkipIncrements()

    override fun addListener(listener: Player.Listener) {
      super.addListener(listener)
      increments.add(listener)
    }

    override fun removeListener(listener: Player.Listener) {
      super.removeListener(listener)
      increments.remove(listener)
    }

    override fun isCommandAvailable(command: Int) = availableCommands.contains(command)
    override fun seekToPrevious() = skipBy(-skipIntervalMs)
    override fun seekToNext() = skipBy(skipIntervalMs)
    override fun seekToPreviousMediaItem() = skipBy(-skipIntervalMs)
    override fun seekToNextMediaItem() = skipBy(skipIntervalMs)
    override fun seekBack() = skipBy(-skipIntervalMs)
    override fun seekForward() = skipBy(skipIntervalMs)
    override fun getSeekBackIncrement() = skipIntervalMs
    override fun getSeekForwardIncrement() = skipIntervalMs
  }

  /** Records the place; must never throw, since it runs from lifecycle callbacks. */
  private fun writeJournal(event: PositionJournal.Event) {
    val playlist = current ?: return
    val p = active
    val entry = PositionJournal.entryFor(
      playlist,
      p.currentMediaItemIndex,
      p.currentMediaItem?.mediaId,
      p.currentPosition,
      placeChangedAt,
      pausedAt,
    ) ?: return
    // Every write restarts the 10 s tick, so writes are never more than 10 s apart while playing.
    handler.removeCallbacks(journalTicker)
    if (p.isPlaying) handler.postDelayed(journalTicker, PositionJournal.TICK_INTERVAL_MS)
    val editor = journalPrefs.edit().putString(Commands.JOURNAL_KEY, PositionJournal.encodeEntry(entry))
    // The book only when it changed (a load, a speed, new chapters), not with every tick.
    if (playlist != journaledPlaylist) {
      editor.putString(Commands.JOURNAL_PLAYLIST_KEY, PositionJournal.encodePlaylist(playlist))
      journaledPlaylist = playlist
    }
    // The process may die right after these two; write them synchronously.
    if (event == PositionJournal.Event.TASK_REMOVED || event == PositionJournal.Event.DESTROY) editor.commit() else editor.apply()
  }

  /** What the session's player is doing, for [tally]; null when it holds no file of [current]. */
  private fun heard(
    index: Int = active.currentMediaItemIndex,
    mediaId: String? = active.currentMediaItem?.mediaId,
    positionMs: Long = active.currentPosition,
  ): Heard? {
    val playlist = current ?: return null
    val p = active
    val file = playlist.files.getOrNull(index)?.takeIf { it.location == mediaId } ?: return null
    return Heard(
      bookId = playlist.bookId,
      title = playlist.title,
      fileIndex = index,
      fileLocation = file.location,
      positionMs = positionMs.coerceAtLeast(0L),
      playing = p.isPlaying,
      engaged = p.playWhenReady && p.playbackState != Player.STATE_ENDED && p.playbackState != Player.STATE_IDLE,
      speed = p.playbackParameters.speed,
    )
  }

  /** Counts what was heard since the last call; must never throw, like [writeJournal]. */
  private fun account(observed: Heard? = heard(), durable: Boolean = false) {
    if (handingOver) return
    Accounting.edit(this, durable) { tally.observe(it, observed, SystemClock.elapsedRealtime(), System.currentTimeMillis()) }
  }

  private fun cancelSleepTimer() {
    if (!sleepTimer.isActive) return
    handler.removeCallbacks(timerTicker)
    sleepTimer.cancel()
    clearBoundary()
    mixer.bedtime = 1f
    publishExtras()
  }

  /** Where the listener is now, for [SleepPlace]; null with no book. */
  private fun placeMark(): PlaceMark? {
    val bookId = current?.bookId ?: return null
    if (player.mediaItemCount == 0) return null
    return PlaceMark(bookId, System.currentTimeMillis(), bookPositionNow(timelineDurations()))
  }

  /** The listener touched the player: they were surely awake here. */
  private fun noteInteraction() {
    placeMark()?.let { lastInteraction = it }
  }

  /** The timer stops playback: keep where, and where the listener last used the player, for the app. */
  private fun keepSleepPlace() {
    val place = placeMark()?.let { SleepPlace.at(it, lastInteraction) }
    val edit = prefs.edit()
    if (place == null) edit.remove(Commands.PREF_SLEEP_PLACE) else edit.putString(Commands.PREF_SLEEP_PLACE, place.encode())
    edit.apply()
  }

  /** The notification's sleep timer button: 15 min → 30 min → end of chapter → off. */
  private fun cycleSleepTimer() {
    val next = SleepCycle.next(SleepCycle.current(sleepTimer.isActive, sleepTimer.mode, sleepPressed))
    when (next) {
      SleepStep.MIN_15 -> startSleepTimer(SleepMode.MINUTES, SleepCycle.MIN_15_MS)
      SleepStep.MIN_30 -> startSleepTimer(SleepMode.MINUTES, SleepCycle.MIN_30_MS)
      SleepStep.CHAPTER -> startSleepTimer(SleepMode.CHAPTER, 0L)
      SleepStep.OFF, SleepStep.OTHER -> cancelSleepTimer()
    }
    // Nothing to time a chapter of: the cycle ends there.
    if (next == SleepStep.CHAPTER && !sleepTimer.isActive) cancelSleepTimer()
    sleepPressed = next.takeIf { sleepTimer.isActive }
  }

  /**
   * The buttons the notification, lock screen, watches and cars show: back and forward by the skip
   * interval (with its number when there is an icon for it) and the sleep timer, whose icon and
   * name say its state. Only sent when something changed.
   */
  private fun updateSleepButton() {
    val step = SleepCycle.current(sleepTimer.isActive, sleepTimer.mode, sleepPressed)
    val offersNext = listNext in queue.indices
    if (step == sleepButtonStep && skipIntervalMs == buttonsSkipMs && offersNext == buttonsListNext) return
    sleepButtonStep = step
    buttonsSkipMs = skipIntervalMs
    buttonsListNext = offersNext
    val seconds = skipIntervalMs / 1_000L
    val back = CommandButton.Builder(SkipIcons.back(skipIntervalMs))
      .setPlayerCommand(Player.COMMAND_SEEK_BACK)
      .setDisplayName(NativeText.t(this, "Back {n} seconds", "n" to seconds))
      .setSlots(CommandButton.SLOT_BACK)
      .build()
    val forward = CommandButton.Builder(SkipIcons.forward(skipIntervalMs))
      .setPlayerCommand(Player.COMMAND_SEEK_FORWARD)
      .setDisplayName(NativeText.t(this, "Forward {n} seconds", "n" to seconds))
      .setSlots(CommandButton.SLOT_FORWARD)
      .build()
    val sleep = CommandButton.Builder(CommandButton.ICON_UNDEFINED)
      .setCustomIconResId(if (step == SleepStep.OFF) R.drawable.lelap_sleep_timer_off else R.drawable.lelap_sleep_timer_on)
      .setDisplayName(SleepCycle.label(step, NativeText.get(this)))
      .setSessionCommand(SessionCommand(Commands.CYCLE_SLEEP_TIMER, Bundle.EMPTY))
      .setSlots(CommandButton.SLOT_OVERFLOW)
      .build()
    // While a list plays (M112): its next item, in the overflow, so ⏮/⏭ keep skipping by time.
    val next = if (offersNext) {
      CommandButton.Builder(CommandButton.ICON_NEXT)
        .setDisplayName(NativeText.t(this, "Next in list"))
        .setSessionCommand(SessionCommand(Commands.NEXT_IN_LIST, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_OVERFLOW)
        .build()
    } else {
      null
    }
    session.setMediaButtonPreferences(listOfNotNull(back, forward, next, sleep))
  }

  /**
   * The bedtime routine, once per night: when Play falls inside the window the app set, or when
   * the window opens while playing. A timer, unless the listener set one, and the quieter volume
   * until the timer ends.
   */
  private fun startBedtimeTimer() {
    val bedtime = Bedtime.decode(prefs.getString(Commands.PREF_BEDTIME, null)) ?: return
    val now = System.currentTimeMillis()
    val (day, minute) = Bedtime.localClock(now, TimeZone.getDefault().getOffset(now))
    val lastNight = if (prefs.contains(Commands.PREF_BEDTIME_NIGHT)) prefs.getLong(Commands.PREF_BEDTIME_NIGHT, 0L) else null
    val night = Bedtime.nightToMark(bedtime, day, minute, lastNight) ?: return
    // A timer the listener set first counts as tonight's, so turning it off later keeps it off.
    prefs.edit().putLong(Commands.PREF_BEDTIME_NIGHT, night).apply()
    if (!sleepTimer.isActive) {
      sleepPressed = null
      if (bedtime.chapter) startSleepTimer(SleepMode.CHAPTER, 0L) else startSleepTimer(SleepMode.MINUTES, bedtime.minutes * 60_000L)
    }
    if (sleepTimer.isActive) mixer.bedtime = bedtime.gain
  }

  /** Saves what plays now for the widget and tile, and tells them; only when it changed. */
  private fun publishNowPlaying(stopping: Boolean = false) {
    val playlist = current
    // A service the widget woke that never loaded a book leaves the last one on the widget.
    if (playlist == null && lastNowPlaying == null) return
    val p = active
    val metadata = p.mediaMetadata
    val encoded = if (playlist == null || player.mediaItemCount == 0) {
      NowPlaying.NOTHING
    } else {
      NowPlaying(
        bookId = playlist.bookId,
        title = playlist.title,
        chapter = metadata.title?.toString()?.takeIf { it != playlist.title },
        author = playlist.author,
        coverUri = playlist.coverUri,
        playing = !stopping && p.playWhenReady && p.playbackState != Player.STATE_ENDED,
        skipMs = skipIntervalMs,
      ).encode()
    }
    if (encoded == lastNowPlaying) return
    lastNowPlaying = encoded
    val editor = getSharedPreferences(Commands.NOW_PLAYING_PREFS, MODE_PRIVATE).edit()
      .putString(Commands.NOW_PLAYING_KEY, encoded)
    if (stopping) editor.commit() else editor.apply()
    sendBroadcast(Intent(Commands.NOW_PLAYING_CHANGED).setPackage(packageName))
  }

  private fun startSleepTimer(mode: SleepMode, durationMs: Long) {
    clearBoundary()
    if (mode == SleepMode.MINUTES) {
      sleepTimer.start(durationMs)
    } else {
      if (current == null || player.mediaItemCount == 0) return
      placeBoundary(mode)
      sleepTimer.startAtBoundary(mode, ::untilBoundary)
    }
    // Set while paused, the timer waits for Play like one the user paused.
    if (!active.playWhenReady) sleepTimer.freeze() else startTicker()
  }

  /**
   * Book-timeline lengths of the files: the tags' (which the chapter marks are measured with)
   * when every file has one, else what the player knows.
   */
  private fun timelineDurations(): List<Long> {
    val tagged = current?.files?.map { it.durationMs }.orEmpty()
    return if (tagged.size == player.mediaItemCount && tagged.all { it > 0 }) tagged else durations()
  }

  private fun bookPositionNow(durations: List<Long>): Long =
    SleepBoundary.bookPosition(active.currentMediaItemIndex, active.currentPosition, durations)

  // While casting no ExoPlayer message stops at the boundary; the timer's own tick does, a
  // moment after it.
  private fun untilBoundary(): Long {
    val boundary = sleepBoundaryMs ?: return 0L
    return SleepBoundary.remainingMs(boundary, bookPositionNow(timelineDurations()), active.playbackParameters.speed)
  }

  /** Finds the end of the chapter (or episode) playing now and arranges to stop there. */
  private fun placeBoundary(mode: SleepMode? = sleepTimer.mode) {
    if (mode == null || mode == SleepMode.MINUTES) return
    boundaryMessage?.cancel()
    boundaryMessage = null
    val durations = timelineDurations()
    val chapters = current?.chapters.orEmpty().map { it.startMs }
    val boundary = SleepBoundary.boundaryMs(mode, bookPositionNow(durations), chapters, durations)
    sleepBoundaryMs = boundary
    val target = SleepBoundary.fileTarget(boundary, durations)
    // The book's own end is caught by onBookEnded, which also keeps Up Next from starting.
    if (target.atFileEnd && target.index >= player.mediaItemCount - 1) return
    boundaryMessage = player.createMessage { _, _ -> onBoundaryReached(target) }
      .setLooper(Looper.getMainLooper())
      .setPosition(target.index, if (target.atFileEnd) C.TIME_END_OF_SOURCE else target.positionMs)
      .setDeleteAfterDelivery(true)
      .send()
  }

  private fun onBoundaryReached(target: FileTarget) {
    if (sleepBoundaryMs == null) return
    sleepTimer.finish()
    // The message arrives a moment late; park the place on the boundary itself, so the next
    // Play starts the next chapter (after smart rewind's few seconds).
    if (target.atFileEnd) player.seekTo(target.index + 1, 0L) else player.seekTo(target.index, target.positionMs)
  }

  private fun clearBoundary() {
    boundaryMessage?.cancel()
    boundaryMessage = null
    sleepBoundaryMs = null
    ticksSincePublish = 0
  }

  /** A shake near the end of the timer: ten more minutes, at full volume again. */
  private fun extendSleepTimer() {
    // Extend first: a chapter timer's time left is measured from its boundary.
    sleepTimer.extend(SHAKE_EXTENSION_MS)
    clearBoundary()
    shake.reset()
    noteInteraction()
    publishExtras()
  }

  // The accelerometer is only on while a shake would count (the timer counting down, in its last
  // minutes, with the setting on), so it costs nothing otherwise. It needs no permission;
  // ExoPlayer's wake lock keeps it reporting with the screen off.
  private fun updateShakeListening() {
    if (shakeToExtend && sleepTimer.acceptsShake) startShakeListening() else stopShakeListening()
  }

  private fun startShakeListening() {
    if (listeningForShake) return
    val accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
    shake.reset()
    // Batched by the sensor hub, so the app wakes a few times a second rather than 50.
    listeningForShake = sensors.registerListener(
      shakeListener,
      accelerometer,
      SensorManager.SENSOR_DELAY_GAME,
      SHAKE_BATCH_US,
    )
  }

  private fun stopShakeListening() {
    if (!listeningForShake) return
    sensors.unregisterListener(shakeListener)
    listeningForShake = false
  }

  private fun startTicker() {
    handler.removeCallbacks(timerTicker)
    handler.postDelayed(timerTicker, TIMER_TICK_MS)
  }

  private fun onPlayingChanged(isPlaying: Boolean) {
    Log.i(TAG, if (isPlaying) "Playing" else "Paused")
    account()
    bankSilence()
    handler.removeCallbacks(journalTicker)
    handler.removeCallbacks(chapterTicker)
    handler.removeCallbacks(pauseSettled)
    if (isPlaying) {
      handler.postDelayed(journalTicker, PositionJournal.TICK_INTERVAL_MS)
      handler.post(chapterTicker)
    } else {
      placeChangedAt = System.currentTimeMillis()
      writeJournal(PositionJournal.Event.PAUSE)
      handler.postDelayed(pauseSettled, PAUSE_SETTLE_MS)
    }
  }

  private fun onItemTransition(reason: Int) {
    // Replacing an item's metadata reports a transition too; only real ones are journaled.
    if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) {
      placeChangedAt = System.currentTimeMillis()
      writeJournal(PositionJournal.Event.ITEM_CHANGE)
    }
  }

  private fun onDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
    // Exact places on both sides of a seek or a file change, so neither adds nor loses time.
    if (!handingOver) Accounting.edit(this) {
      tally.jumped(
        it,
        heard(oldPosition.mediaItemIndex, oldPosition.mediaItem?.mediaId, oldPosition.positionMs),
        heard(newPosition.mediaItemIndex, newPosition.mediaItem?.mediaId, newPosition.positionMs),
        SystemClock.elapsedRealtime(),
        System.currentTimeMillis(),
      )
    }
    if (reason != Player.DISCONTINUITY_REASON_SEEK) return
    placeChangedAt = System.currentTimeMillis()
    writeJournal(PositionJournal.Event.SEEK)
    updateChapterTitle()
    // A seek into another chapter moves a chapter timer to that chapter's end.
    if (sleepBoundaryMs != null) {
      placeBoundary()
      publishExtras()
    }
  }

  /** The receiver's player, heard like ExoPlayer but without audio focus: the phone plays nothing. */
  private val remoteListener = object : Player.Listener {
    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      account()
      remoteLink?.keepAwake(playWhenReady)
      if (playWhenReady) {
        // Smart rewind already went into the receiver's Play (see [rewoundPlace]).
        pausedAt = null
        port.resumeSleepTimer()
        startBedtimeTimer()
      } else {
        pausedAt = System.currentTimeMillis()
        port.freezeSleepTimer()
      }
      publishExtras()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) = onPlayingChanged(isPlaying)

    // The last part ended on the receiver: logged as finished, then Up Next on the same receiver.
    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_ENDED) onBookEnded()
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = onItemTransition(reason)

    // The speed asked for, also when the receiver refused it: the phone plays at it after the hand-back.
    override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
      val speed = remote?.requestedSpeed ?: playbackParameters.speed
      current?.let { current = PositionJournal.withSpeed(it, speed) }
      writeJournal(PositionJournal.Event.SPEED)
    }

    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) =
      onDiscontinuity(oldPosition, newPosition, reason)

    override fun onEvents(player: Player, events: Player.Events) = publishNowPlaying()
  }

  /** The session ended on the receiver's side (lost, or another phone took it): hand back, paused. */
  private val linkWatcher = object : CastLink.Listener {
    override fun onStatus(status: RendererStatus) = Unit

    override fun onClosed(error: String?) {
      handler.post { if (remote != null) endRemote(resume = false, error = error) }
    }
  }

  /**
   * Moves the loaded book to the receiver the app connected ([CastLink.current]), from the place
   * here, and makes it the session's player. Completes once the first file loaded there.
   */
  private fun startRemote(): ListenableFuture<SessionResult> {
    val link = CastLink.current?.takeIf { !it.closed }
    if (link == null || current == null || player.mediaItemCount == 0) {
      return Futures.immediateFuture(SessionResult(SessionError(SessionError.ERROR_BAD_VALUE, "Nothing to cast")))
    }
    if (remoteLink === link) return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    endRemote(resume = false)
    account()
    val index = player.currentMediaItemIndex
    val speed = player.playbackParameters.speed
    // Smart rewind goes into the start place, so the receiver loads once.
    val position = rewoundPlace(index, player.currentPosition) ?: player.currentPosition
    handingOver = true
    player.pause()
    // Stopped, not only paused: ExoPlayer keeps the book and place but fetches nothing meanwhile.
    player.stop()
    handingOver = false
    val items = List(player.mediaItemCount) { player.getMediaItemAt(it) }
    val r = RemotePlayer(Looper.getMainLooper(), link, ::castRequest, ::onRemoteItemsPicked, ::onRemoteLoaded, ::rewoundPlace)
    remote = r
    remoteLink = link
    link.addListener(linkWatcher)
    r.addListener(remoteListener)
    val started = SettableFuture.create<SessionResult>()
    castStart = started
    // Loaded before the swap, so the session never shows an empty player in between.
    r.setBook(items, timelineDurations(), index, position, speed, play = true, outroAtMs = remoteOutroAt())
    session.player = SkippingPlayer(r)
    publishExtras()
    return started
  }

  /**
   * Back to the phone: ExoPlayer takes the session again at the receiver's place, and plays on if
   * the receiver was playing ([resume] null) or as asked; the receiver stops.
   */
  private fun endRemote(resume: Boolean?, error: String? = null) {
    val r = remote ?: return
    // Time on the receiver counts as listening, up to the hand-back.
    account()
    val link = remoteLink
    val index = r.currentMediaItemIndex
    val position = r.currentPosition
    val playing = r.playWhenReady
    val speed = r.requestedSpeed
    // A fade under way gives the receiver its volume back before it stops.
    r.setFade(1f)
    remote = null
    remoteLink = null
    link?.removeListener(linkWatcher)
    r.removeListener(remoteListener)
    session.player = SkippingPlayer(player)
    r.release()
    link?.closeInBackground(error)
    castStart?.set(SessionResult(SessionError(SessionError.ERROR_UNKNOWN, error ?: NativeText.t(this, "Casting stopped"))))
    castStart = null
    handingOver = true
    if (player.mediaItemCount > 0) {
      player.setPlaybackSpeed(speed)
      player.seekTo(index.coerceIn(0, player.mediaItemCount - 1), position)
      player.prepare()
    }
    handingOver = false
    if (resume ?: playing) {
      // Handed over while playing: no smart rewind, the listener heard every second.
      if (playing) pausedAt = null
      player.play()
    } else {
      // Lost or handed back paused: the timer waits for Play, and so does smart rewind.
      if (playing) pausedAt = System.currentTimeMillis()
      port.freezeSleepTimer()
      // Nothing plays now: the scrobble session ends at the receiver's place.
      account()
    }
    publishExtras()
    publishNowPlaying()
  }

  private fun onRemoteLoaded(failure: String?) {
    castStart?.set(
      if (failure == null) {
        SessionResult(SessionResult.RESULT_SUCCESS)
      } else {
        SessionResult(SessionError(SessionError.ERROR_UNKNOWN, failure))
      },
    )
    castStart = null
    if (failure != null) endRemote(resume = false, error = failure)
  }

  /** Android Auto picked a book while casting: it plays on the receiver too. */
  private fun onRemoteItemsPicked(items: List<MediaItem>, index: Int, positionMs: Long) {
    val r = remote ?: return
    player.setMediaItems(items, index, positionMs)
    r.setBook(items, timelineDurations(), index, positionMs, current?.speed?.coerceIn(0.5f, 3f) ?: 1f, r.playWhenReady, remoteOutroAt())
    writeJournal(PositionJournal.Event.ITEM_CHANGE)
  }

  /** A part of the loaded book as the receiver gets it. */
  private fun castRequest(index: Int): CastRequest? {
    val book = current ?: return null
    val file = book.files.getOrNull(index) ?: return null
    return CastRequest(
      uri = file.uri,
      title = if (book.files.size > 1) file.title else book.title,
      artist = book.author,
      album = book.title,
      coverUri = book.coverUri,
      durationMs = file.durationMs,
      fileName = file.name,
      headers = book.headers,
      viaPhone = book.privateUris,
    )
  }

  private inner class Port : PlaybackRules.Port {
    override val playWhenReady: Boolean
      get() = player.playWhenReady

    override fun pause() = player.pause()

    // A call that ends while casting must not start the phone alongside the receiver.
    override fun play() {
      if (remote == null) player.play()
    }

    override fun requestFocus() = focus.request()

    override fun abandonFocus() = focus.abandon()

    override fun setDuck(level: Float) {
      mixer.duck = level
    }

    override fun freezeSleepTimer() {
      if (!sleepTimer.isRunning) return
      handler.removeCallbacks(timerTicker)
      sleepTimer.freeze()
      publishExtras()
    }

    override fun resumeSleepTimer() {
      if (!sleepTimer.isActive || sleepTimer.isRunning) return
      // Smart rewind may have moved the place back across the boundary.
      placeBoundary()
      sleepTimer.resume()
      startTicker()
      publishExtras()
    }
  }

  private fun publishExtras() {
    if (!::session.isInitialized) return
    ticksSincePublish = 0
    updateShakeListening()
    updateSleepButton()
    session.setSessionExtras(
      Bundle().apply {
        putBoolean(Commands.EXTRA_DUCK, focus.interruption == Interruption.DUCK)
        putBoolean(Commands.EXTRA_WAITING_FOR_FOCUS, rules.isWaitingForFocus)
        sleepTimer.mode?.let { putString(Commands.EXTRA_SLEEP_TIMER_MODE, it.wire) }
        val remaining = sleepTimer.remainingMs?.coerceAtLeast(0L)
        if (sleepTimer.isRunning) {
          // A chapter timer's end is an estimate from the place and speed, renewed while it runs.
          val end = sleepTimer.endsAtMs ?: remaining?.let { SystemClock.elapsedRealtime() + it }
          end?.let { putLong(Commands.EXTRA_SLEEP_TIMER_END, it) }
        } else {
          remaining?.let { putLong(Commands.EXTRA_SLEEP_TIMER_FROZEN, it) }
        }
      },
    )
  }

  /**
   * Lets the car app that asked read the covers of [nodes] through [CoverProvider], which isn't
   * exported (M107). A grant lasts until the phone restarts; the provider still serves only
   * covers of books the car lists.
   */
  private fun grantCovers(browser: MediaSession.ControllerInfo, nodes: List<CarNode>) {
    val uris = CarCovers.grants(nodes.map { it.artworkUri }, CarCovers.authority(packageName), browser.packageName, packageName)
    for (uri in uris) {
      try {
        grantUriPermission(browser.packageName, Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (e: SecurityException) {
        Log.w(TAG, "Could not grant a cover to ${browser.packageName}", e)
      }
    }
  }

  private inner class Callback : MediaLibrarySession.Callback {
    override fun onConnect(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
    ): MediaSession.ConnectionResult {
      // The service is exported for system UI, Bluetooth and Android Auto. Only Lelap itself may
      // load books, set the queue or change settings; other apps get the standard controls.
      // The sleep timer button is for everyone: the lock screen, watches and cars show it too.
      if (controller.packageName != packageName) {
        return MediaSession.ConnectionResult.accept(
          MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
            .add(SessionCommand(Commands.CYCLE_SLEEP_TIMER, Bundle.EMPTY))
            .add(SessionCommand(Commands.NEXT_IN_LIST, Bundle.EMPTY))
            .build(),
          MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS,
        )
      }
      val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
        .add(SessionCommand(Commands.CYCLE_SLEEP_TIMER, Bundle.EMPTY))
        .add(SessionCommand(Commands.SET_SETTINGS, Bundle.EMPTY))
        .add(SessionCommand(Commands.START_SLEEP_TIMER, Bundle.EMPTY))
        .add(SessionCommand(Commands.CANCEL_SLEEP_TIMER, Bundle.EMPTY))
        .add(SessionCommand(Commands.LOAD_BOOK, Bundle.EMPTY))
        .add(SessionCommand(Commands.UNLOAD, Bundle.EMPTY))
        .add(SessionCommand(Commands.SET_QUEUE, Bundle.EMPTY))
        .add(SessionCommand(Commands.START_CAST, Bundle.EMPTY))
        .add(SessionCommand(Commands.STOP_CAST, Bundle.EMPTY))
        .add(SessionCommand(Commands.SETTLE_ACCOUNTING, Bundle.EMPTY))
        .add(SessionCommand(Commands.SKIP, Bundle.EMPTY))
        .add(SessionCommand(Commands.NEXT_IN_LIST, Bundle.EMPTY))
        .build()
      return MediaSession.ConnectionResult.accept(
        commands,
        MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS,
      )
    }

    override fun onCustomCommand(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      customCommand: SessionCommand,
      args: Bundle,
    ): ListenableFuture<SessionResult> {
      when (customCommand.customAction) {
        Commands.SET_SETTINGS -> {
          val duck = args.getBoolean(Commands.EXTRA_DUCK, true)
          rules.interruption = interruptionOf(duck)
          focus.interruption = rules.interruption
          rules.duckLevel = duckLevelOf(
            if (args.containsKey(Commands.KEY_DUCK_LEVEL)) args.getFloat(Commands.KEY_DUCK_LEVEL) else null,
          )
          val interval = args.getLong(Commands.KEY_SKIP_INTERVAL_MS, 30_000L).coerceIn(5_000L, 300_000L)
          if (interval != skipIntervalMs) {
            skipIntervalMs = interval
            (session.player as? SkippingPlayer)?.increments?.announce(interval)
          }
          smartRewind = args.getBoolean(Commands.KEY_SMART_REWIND, true)
          shakeToExtend = args.getBoolean(Commands.KEY_SHAKE_TO_EXTEND, true)
          updateShakeListening()
          sound.mono = args.getBoolean(Commands.KEY_MONO, false)
          sound.boost = args.getBoolean(Commands.KEY_VOLUME_BOOST, false)
          soundDefaults = SoundChoice(
            voiceEq = args.getBoolean(Commands.KEY_VOICE_EQ, false),
            skipSilence = args.getBoolean(Commands.KEY_SKIP_SILENCE, false),
            evenLoudness = args.getBoolean(Commands.KEY_EVEN_LOUDNESS, false),
          )
          applySound()
          prefs.edit()
            .putBoolean(Commands.EXTRA_DUCK, duck)
            .putFloat(Commands.KEY_DUCK_LEVEL, rules.duckLevel)
            .putLong(Commands.KEY_SKIP_INTERVAL_MS, skipIntervalMs)
            .putBoolean(Commands.KEY_SMART_REWIND, smartRewind)
            .putBoolean(Commands.KEY_SHAKE_TO_EXTEND, shakeToExtend)
            .putBoolean(Commands.KEY_MONO, sound.mono)
            .putBoolean(Commands.KEY_VOICE_EQ, soundDefaults.voiceEq)
            .putBoolean(Commands.KEY_SKIP_SILENCE, soundDefaults.skipSilence)
            .putBoolean(Commands.KEY_EVEN_LOUDNESS, soundDefaults.evenLoudness)
            .putBoolean(Commands.KEY_VOLUME_BOOST, sound.boost)
            .apply()
        }
        Commands.START_SLEEP_TIMER -> {
          val mode = SleepMode.fromWire(args.getString(Commands.KEY_SLEEP_MODE)) ?: SleepMode.MINUTES
          sleepPressed = null
          // The listener's own timer replaces the routine's, and its volume with it.
          mixer.bedtime = 1f
          startSleepTimer(mode, args.getLong(Commands.KEY_DURATION_MS))
          noteInteraction()
        }
        Commands.CANCEL_SLEEP_TIMER -> {
          cancelSleepTimer()
          noteInteraction()
        }
        Commands.CYCLE_SLEEP_TIMER -> {
          mixer.bedtime = 1f
          cycleSleepTimer()
          noteInteraction()
        }
        // Another profile is listening now and has nothing to play: clear the lock screen and
        // notification. The place was journaled at the pause before this.
        Commands.UNLOAD -> {
          endRemote(resume = false)
          account()
          writeJournal(PositionJournal.Event.PAUSE)
          handler.removeCallbacks(pauseSettled)
          player.pause()
          cancelSleepTimer()
          player.clearMediaItems()
          current = null
          forgetJournaledBook()
          lastInteraction = null
        }
        Commands.SET_QUEUE -> {
          val json = args.getString(Commands.KEY_QUEUE_JSON).orEmpty()
          val decoded = UpNext.decodeQueue(json)
          saveQueue(decoded, args.getInt(Commands.KEY_LIST_NEXT, -1).takeIf { it in decoded.indices } ?: -1)
        }
        Commands.NEXT_IN_LIST -> skipToListNext()
        Commands.START_CAST -> return startRemote()
        Commands.SETTLE_ACCOUNTING -> account()
        Commands.SKIP -> {
          // A player with nothing loaded can't seek; Play would start the book, so load it paused.
          val loaded = player.mediaItemCount == 0 && journalLoad()?.let { loadBook(it, autoplay = false) } != null
          val forward = args.getBoolean(Commands.KEY_FORWARD, true)
          skipBy(if (forward) skipIntervalMs else -skipIntervalMs)
          // The listener picked this place; Play shouldn't rewind from it for the old pause.
          if (loaded) pausedAt = null
        }
        Commands.STOP_CAST ->
          endRemote(resume = if (args.containsKey(Commands.KEY_RESUME)) args.getBoolean(Commands.KEY_RESUME) else null)
        Commands.LOAD_BOOK -> {
          val load = PositionJournal.decodeLoad(args.getString(Commands.KEY_BOOK_JSON).orEmpty())
            ?: return Futures.immediateFuture(
              SessionResult(SessionError(SessionError.ERROR_BAD_VALUE, "The player could not read this book")),
            )
          val autoplay = args.getBoolean(Commands.KEY_AUTOPLAY, false)
          // A touch in another book says nothing about this one.
          if (lastInteraction?.bookId != load.playlist.bookId) lastInteraction = null
          loadBook(load, autoplay)
          // The listener's Play from the library: it plays through ExoPlayer, not the session.
          if (autoplay) noteInteraction()
        }
        else -> return Futures.immediateFuture(
          SessionResult(SessionError(SessionError.ERROR_NOT_SUPPORTED, "Unknown command ${customCommand.customAction}")),
        )
      }
      publishExtras()
      // The widget's skip buttons say the skip interval.
      publishNowPlaying()
      return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    // Controllers strip the URI from media items, so rebuild it from the request metadata.
    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> = Futures.immediateFuture(
      mediaItems.map { item ->
        if (item.localConfiguration != null) {
          item
        } else {
          item.buildUpon().setUri(item.requestMetadata.mediaUri).build()
        }
      }.toMutableList(),
    )

    // Play from headphones, Bluetooth or the system media controls after the app and service
    // were gone: restore the last book from the journal.
    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      isForPlayback: Boolean,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      val (entry, playlist) = journaled()
        ?: return Futures.immediateFailedFuture(UnsupportedOperationException("Nothing to resume"))
      val index = playlist.files.indexOfFirst { it.location == entry.fileLocation }
      if (index < 0) return Futures.immediateFailedFuture(UnsupportedOperationException("Journal file not in its book"))
      // Not for playback: System UI only shows what would resume, so change nothing here.
      if (!isForPlayback) {
        return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(mediaItems(playlist), index, entry.filePositionMs))
      }
      current = playlist
      player.setPlaybackSpeed(playlist.speed.coerceIn(0.5f, 3f))
      pausedAt = null
      val start = SeekRules.startPosition(index, entry.filePositionMs, entry.pauseStartedAt, System.currentTimeMillis(), smartRewind, playlist.introMs)
      return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(mediaItems(playlist), index, start))
    }

    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> =
      Futures.immediateFuture(LibraryResult.ofItem(carItem(CarLibrary.root()), params))

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      val nodes = CarLibrary.children(
        parentId,
        carSnapshot(),
        journalLoad(),
        NativeText.get(this@PlaybackService),
        CarCovers.authority(packageName),
      )
        ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
      val from = (page.toLong() * pageSize).coerceAtMost(nodes.size.toLong()).toInt()
      val to = (from.toLong() + pageSize).coerceAtMost(nodes.size.toLong()).toInt()
      val shown = nodes.subList(from, to)
      grantCovers(browser, shown)
      return Futures.immediateFuture(
        LibraryResult.ofItemList(ImmutableList.copyOf(shown.map(::carItem)), params),
      )
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val node = CarLibrary.item(
        mediaId,
        carSnapshot(),
        journalLoad(),
        NativeText.get(this@PlaybackService),
        CarCovers.authority(packageName),
      )
        ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
      grantCovers(browser, listOf(node))
      return Futures.immediateFuture(LibraryResult.ofItem(carItem(node), null))
    }

    // A controller (Android Auto) picked an item from the browse tree: load that whole book.
    override fun onSetMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
      startIndex: Int,
      startPositionMs: Long,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      val picked = mediaItems.singleOrNull()?.takeIf { it.localConfiguration == null }
      val load = picked?.let { CarLibrary.resolve(it.mediaId, carSnapshot(), journalLoad()) }
        ?: return super.onSetMediaItems(mediaSession, controller, mediaItems, startIndex, startPositionMs)
      return Futures.immediateFuture(carPlay(load))
    }
  }
}

/** Opens a link again, once, when its host says it expired; see [ExpiringLinks]. */
@OptIn(UnstableApi::class)
private class ExpiringLinkPolicy(
  /** Called on the loading thread with the status that made it open the link again. */
  private val onRefresh: (Int) -> Unit,
) : DefaultLoadErrorHandlingPolicy() {
  override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
    // A refused SMB or SFTP login or a changed host key stays so; each retry is another login
    // attempt, which can get the phone blocked by the server.
    val refused = generateSequence<Throwable>(loadErrorInfo.exception) { it.cause }
      .filterIsInstance<NetFailure>().firstOrNull()?.kind?.permanent == true
    if (refused) return C.TIME_UNSET
    val code = generateSequence<Throwable>(loadErrorInfo.exception) { it.cause }
      .filterIsInstance<HttpDataSource.InvalidResponseCodeException>()
      .firstOrNull()?.responseCode
    return when (code?.let { ExpiringLinks.decide(it, loadErrorInfo.errorCount) }) {
      // The retry opens the item's own URL from the byte it reached, so the place is kept.
      LinkRetry.REFRESH -> 0L.also { code?.let(onRefresh) }
      LinkRetry.GIVE_UP -> C.TIME_UNSET
      else -> super.getRetryDelayMsFor(loadErrorInfo)
    }
  }
}
