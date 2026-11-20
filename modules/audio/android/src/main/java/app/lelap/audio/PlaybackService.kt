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
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import app.lelap.headless.ServerTasks
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
import app.lelap.cast.LiveAudio
import app.lelap.cast.RendererStatus
import java.util.TimeZone
import org.json.JSONArray
import org.json.JSONObject

// A chapter or episode timer's end moves with seeks and speed; the app hears it this often.
private const val BOUNDARY_PUBLISH_MS = 5_000L
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
  private var boundaryPublishedAt = 0L

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
        ?.let { book ->
          book.files.flatMap { file -> listOfNotNull(file.uri, file.auto?.unmetered, file.auto?.metered) }
            .associateWith { book.headers }
        }
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
      for (id in CarLibrary.listIds(carSnapshot())) session.notifyChildrenChanged(id, Int.MAX_VALUE, null)
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

  // The notification's and car's Back after a jump made away from the app (M138).
  private val backOffer = BackOffer(SystemClock::elapsedRealtime)
  private var buttonsBack: Boolean? = null
  /** True while Media3 handles a headphone or Bluetooth button; see onMediaButtonEvent. */
  private var mediaButtonPressed = false
  private val backExpired = Runnable { if (backOffer.expire()) updateSleepButton() }

  private var queue: List<BookLoad> = emptyList()
  /** Where the followed list's next item is in [queue]; -1 without a list (M112). */
  private var listNext = -1
  private var buttonsListNext: Boolean? = null
  /** The followed list, for Previous in list and the widget's list line (M119); null without one. */
  private var following: ListPlay? = null
  private var buttonsListPrevious: Boolean? = null

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

  // Wakes at the next chapter mark rather than every second (M106); seeks and speed restart it.
  private val chapterTicker = object : Runnable {
    override fun run() {
      updateChapterTitle()
      val p = active
      val playlist = current ?: return
      if (!p.isPlaying) return
      val wait = Battery.chapterTickMs(playlist, p.currentMediaItemIndex, p.currentPosition, p.playbackParameters.speed)
      handler.postDelayed(this, wait)
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

  // Every 5 s until the fade, then every quarter second (M106); seeks and speed restart it.
  private val timerTicker = object : Runnable {
    override fun run() {
      sleepTimer.tick()
      updateShakeListening()
      if (sleepBoundaryMs != null && SystemClock.elapsedRealtime() - boundaryPublishedAt >= BOUNDARY_PUBLISH_MS) publishExtras()
      if (sleepTimer.isRunning) handler.postDelayed(this, Battery.sleepTickMs(sleepTimer.remainingMs))
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

    // A receiver takes the timer's fade and the bedtime routine's quieter volume too (M125).
    mixer = VolumeMixer(applyReceiver = { remote?.setFade(it) }) { player.volume = it }
    sleepTimer = SleepTimer(
      clock = SystemClock::elapsedRealtime,
      onVolume = { mixer.fade = it },
      onFinished = {
        // The timer's stop goes into the history; the app offers going back from it (M86, M138).
        placeNow()?.let { (bookId, at) -> record(bookId, PlaybackHistory.SLEEP, PlaybackHistory.SLEEP_TIMER, at, at) }
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
    following = ListPlay.decode(prefs.getString(Commands.PREF_LIST, null))
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
        retime()
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
    handler.removeCallbacks(backExpired)
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
   * listener's defaults (M84). While casting, the phone renders the parts with them (M134).
   */
  private fun applySound() {
    if (!::player.isInitialized) return
    val choice = soundDefaults.with(current?.sound)
    sound.voiceEq = choice.voiceEq
    sound.evenLoudness = choice.evenLoudness
    if (player.skipSilenceEnabled != choice.skipSilence) player.skipSilenceEnabled = choice.skipSilence
    remote?.let(::applyCastSound)
  }

  // Skip silence as the rendered stream last started with; it can't change mid-stream.
  private var castSkipSilence = false

  /** Any effect on: the phone renders for the receiver. Skip silence changing starts the stream again. */
  private fun applyCastSound(r: RemotePlayer) {
    val choice = soundDefaults.with(current?.sound)
    val skip = choice.skipSilence
    val skipChanged = skip != castSkipSilence
    castSkipSilence = skip
    val wasRendering = r.rendering
    r.setEffects(choice.voiceEq || skip || choice.evenLoudness || sound.mono || sound.boost)
    // Switching rendering on or off already started the stream again.
    if (skipChanged && wasRendering && r.rendering) r.restartRendering()
  }

  /** A part rendered for the receiver with the listener's effects (M134). */
  private fun renderForCast(request: CastRequest, startMs: Long, speed: Float): LiveAudio =
    EffectsStream(this, request, startMs, speed, castSkipSilence, sound)

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
      Accounting.edit(this) { tally.finishStart(it, ended.bookId) }
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
    // A finished item comes back with Previous in list only where the list plays them again.
    following = following?.let {
      val again = if (it.keepsFinished) BookLoad(ended, 0, 0L, handsOver = true) else null
      ListSteps.moved(it, again, next.playlist.bookId, nextInList = listNext == 0)
    }
    saveQueue(rest, UpNext.listNextAfterHead(listNext, rest))
    loadBook(next, autoplay = true)
    locateStarted(next.playlist)
    updateSleepButton()
  }

  /** Next in list (M112): the list's next item now, playing if this one was. */
  private fun skipToListNext() {
    val (next, rest, after) = UpNext.skipToListNext(listNext, queue)
    if (next == null) return
    val play = active.playWhenReady
    following = following?.let { ListSteps.moved(it, liveLoad(), next.playlist.bookId, nextInList = true) }
    saveQueue(rest, after)
    loadBook(next, autoplay = play)
    locateStarted(next.playlist)
    updateSleepButton()
  }

  /** Previous in list (M119): the list's item before this one, which comes next again after it. */
  private fun skipToListPrevious() {
    val list = following ?: return
    val here = liveLoad() ?: return
    val step = ListSteps.previous(list, queue, listNext, here) ?: return
    val play = active.playWhenReady
    following = step.list
    saveQueue(step.queue, step.listNext)
    loadBook(step.play, autoplay = play)
    locateStarted(step.play.playlist)
    updateSleepButton()
  }

  /** The loaded book at its live place, to come back to. */
  private fun liveLoad(): BookLoad? {
    val playlist = current ?: return null
    if (player.mediaItemCount == 0) return null
    return BookLoad(
      playlist,
      active.currentMediaItemIndex,
      active.currentPosition,
      pausedAt = System.currentTimeMillis(),
      handsOver = true,
    )
  }

  private fun saveQueue(list: List<BookLoad>, nextInList: Int) {
    queue = list
    listNext = nextInList
    prefs.edit()
      .putString(Commands.PREF_QUEUE, encodeQueue(list))
      .putInt(Commands.PREF_LIST_NEXT, nextInList)
      .putString(Commands.PREF_LIST, following?.encode().orEmpty())
      .apply()
    updateSleepButton()
    publishNowPlaying()
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

  /**
   * A book the service started by itself, from the last addresses the app gave it: an add-on
   * server that locates its files (Plex away from home) is asked where they are now, and the app
   * moves the book there at its live place (M123).
   */
  private fun locateStarted(playlist: BookPlaylist) {
    if (playlist.locate) ServerTasks.request(this, ServerTasks.LOCATE, playlist.bookId)
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
      if (PositionJournal.filesChanged(loaded, playlist, onMobileData())) {
        switchFiles(load, autoplay)
        return
      }
      // The same picked files with other addresses or another automatic pair (M121): kept for the
      // next rebuild of the items, which picks by the connection then.
      if (loaded.files != playlist.files) current = (current ?: loaded).copy(files = playlist.files)
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
        retime()
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
    // A book picked in the car plays on its own: the list leaves, with its items in the queue,
    // until the app sends a list. Up Next stays.
    if (listNext >= 0 || following != null) {
      following = null
      saveQueue(if (listNext >= 0) queue.take(listNext) else queue, -1)
    }
    prefs.edit().remove(Commands.PREF_LIST_STARTED).apply()
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
    locateStarted(playlist)
    return MediaSession.MediaItemsWithStartPosition(mediaItems(playlist), index, start)
  }

  /**
   * A list's item picked in Android Auto (M119): it plays like a book picked there, and the service
   * follows the list on from it, Up Next first, then tells the app which list it follows.
   */
  private fun carPlayList(start: CarListStart): MediaSession.MediaItemsWithStartPosition {
    val upNext = if (listNext >= 0) queue.take(listNext) else queue
    val bookId = start.load.playlist.bookId
    val (rest, next) = ListSteps.startQueue(upNext, bookId, start.after)
    val items = carPlay(start.load)
    following = ListPlay(
      id = start.list.id,
      title = start.list.title,
      at = bookId,
      before = start.before.take(ListSteps.BEFORE_LIMIT),
      keepsFinished = start.list.keepsFinished,
    )
    saveQueue(rest, next)
    prefs.edit()
      .putString(Commands.PREF_LIST_STARTED, ListSteps.encodeStarted(start.list.id, bookId, start.list.order))
      .apply()
    return items
  }

  // Every book the player gets passes here (the app, the car, playback resumption), so the wake
  // mode follows the files: a finished download no longer needs the Wi-Fi lock (M106).
  private fun mediaItems(playlist: BookPlaylist): List<MediaItem> {
    player.setWakeMode(Battery.wakeModeFor(playlist.files.map { it.uri }))
    return itemsOf(playlist)
  }

  private fun itemsOf(playlist: BookPlaylist): List<MediaItem> {
    val mobileData = onMobileData()
    return playlist.files.mapIndexed { index, file -> itemOf(playlist, index, file, mobileData) }
  }

  /** Mobile data, as the app's `expo-network` sees it, so both pick the same episode file. */
  private fun onMobileData(): Boolean = try {
    val connectivity = getSystemService(ConnectivityManager::class.java)
    connectivity?.getNetworkCapabilities(connectivity.activeNetwork)
      ?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
  } catch (e: SecurityException) {
    false
  }

  private fun itemOf(playlist: BookPlaylist, index: Int, file: BookFile, mobileData: Boolean): MediaItem {
    // An automatic episode file follows the connection now, also with the app closed (M121).
    val uri = Uri.parse(EpisodeFiles.uriFor(file, mobileData))
    return MediaItem.Builder()
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

  /**
   * Back or forward by [deltaMs]: always the listener's own press (a controller or the widget),
   * logged from [source]; null for the app, which logs its own.
   */
  private fun skipBy(deltaMs: Long, source: String?) {
    if (player.mediaItemCount == 0) return
    val before = placeNow()
    val (index, position) = SeekRules.skip(active.currentMediaItemIndex, active.currentPosition, deltaMs, durations())
    active.seekTo(index, position)
    jumped(before, PlaybackHistory.SKIP, source, index to position)
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
    /** A press of Play or Pause from a controller, for the history (M138). */
    private fun pressed(action: String, command: () -> Unit) {
      val source = currentSource()
      command()
      placeNow()?.let { (bookId, at) -> if (source != null) record(bookId, action, source, at, at) }
    }

    /** A seek from a controller: the history, and Back on the notification after a long one. */
    private fun sought(index: Int, positionMs: Long?, command: () -> Unit) {
      val before = placeNow()
      command()
      jumped(before, PlaybackHistory.SEEK, currentSource(), positionMs?.let { index to it })
    }

    override fun play() = pressed(PlaybackHistory.PLAY) { super.play() }
    override fun pause() = pressed(PlaybackHistory.PAUSE) { super.pause() }
    override fun setPlayWhenReady(playWhenReady: Boolean) =
      pressed(if (playWhenReady) PlaybackHistory.PLAY else PlaybackHistory.PAUSE) { super.setPlayWhenReady(playWhenReady) }
    override fun seekTo(positionMs: Long) = sought(currentMediaItemIndex, positionMs) { super.seekTo(positionMs) }
    override fun seekTo(mediaItemIndex: Int, positionMs: Long) =
      sought(mediaItemIndex, positionMs) { super.seekTo(mediaItemIndex, positionMs) }
    // Play on an ended book comes here (Media3's play button); not a jump the listener made.
    override fun seekToDefaultPosition() = super.seekToDefaultPosition()
    override fun seekToDefaultPosition(mediaItemIndex: Int) = sought(mediaItemIndex, null) { super.seekToDefaultPosition(mediaItemIndex) }

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
    override fun seekToPrevious() = skipBy(-skipIntervalMs, currentSource())
    override fun seekToNext() = skipBy(skipIntervalMs, currentSource())
    override fun seekToPreviousMediaItem() = skipBy(-skipIntervalMs, currentSource())
    override fun seekToNextMediaItem() = skipBy(skipIntervalMs, currentSource())
    override fun seekBack() = skipBy(-skipIntervalMs, currentSource())
    override fun seekForward() = skipBy(skipIntervalMs, currentSource())
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
      ended = p.playbackState == Player.STATE_ENDED,
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

  /** The book and its whole-book place now, for the history; null with no book. */
  private fun placeNow(): Pair<String, Long>? {
    val bookId = current?.bookId ?: return null
    if (player.mediaItemCount == 0) return null
    return bookId to bookPositionNow(timelineDurations())
  }

  /**
   * Where the command being handled came from, for the history; null for the app, which logs its
   * own taps, and for the service's own moves.
   */
  private fun currentSource(): String? = sourceOf(session.controllerForCurrentRequest)

  private fun sourceOf(controller: MediaSession.ControllerInfo?): String? {
    if (controller == null) return null
    if (mediaButtonPressed) return PlaybackHistory.HEADPHONES
    return PlaybackHistory.sourceOf(
      packageName = controller.packageName,
      ownPackage = packageName,
      isApp = controller.connectionHints.getBoolean(Commands.HINT_APP, false),
      isNotification = session.isMediaNotificationController(controller),
      isCar = session.isAutomotiveController(controller) || session.isAutoCompanionController(controller),
    )
  }

  /** Keeps an action for the app's history, also while the app is closed (M138). */
  private fun record(bookId: String, action: String, source: String, fromMs: Long, toMs: Long) {
    val entry = HistoryReport(bookId, action, source, System.currentTimeMillis(), fromMs, toMs)
    prefs.edit().putString(Commands.PREF_HISTORY, PlaybackHistory.append(prefs.getString(Commands.PREF_HISTORY, null), entry)).apply()
  }

  /** A skip or seek moved the place from [before]: logged, and Back offered after a long one away from the app. */
  private fun jumped(before: Pair<String, Long>?, action: String, source: String?, target: Pair<Int, Long>? = null) {
    val now = placeNow() ?: return
    // A receiver reports the place before the seek for a while, so the target says where it went.
    val after = target?.let { (index, at) -> now.first to PlaybackHistory.landing(index, at, timelineDurations()) } ?: now
    if (before == null || before.first != after.first) return
    if (source != null) record(after.first, action, source, before.second, after.second)
    if (backOffer.jumped(after.first, before.second, after.second, external = source != null)) updateSleepButton()
    handler.removeCallbacks(backExpired)
    backOffer.offer?.let { handler.postDelayed(backExpired, (it.untilMs - SystemClock.elapsedRealtime()).coerceAtLeast(0L)) }
  }

  /** The notification's or car's Back: to where the listener was before the jump. */
  private fun goBack(source: String?) {
    val offer = backOffer.offer ?: return
    backOffer.clear()
    handler.removeCallbacks(backExpired)
    val before = placeNow()
    if (before?.first == offer.bookId) {
      val target = SleepBoundary.fileTarget(offer.fromMs, timelineDurations())
      // A place on a file's end is the next file's start, so the file doesn't end again.
      if (target.atFileEnd && target.index + 1 < active.mediaItemCount) active.seekTo(target.index + 1, 0L) else active.seekTo(target.index, target.positionMs)
      if (source != null) record(offer.bookId, PlaybackHistory.SEEK, source, before.second, offer.fromMs)
    }
    updateSleepButton()
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
    val offersPrevious = ListSteps.offersPrevious(following, current?.bookId)
    val offersBack = backOffer.offer != null
    if (step == sleepButtonStep && skipIntervalMs == buttonsSkipMs && offersNext == buttonsListNext &&
      offersPrevious == buttonsListPrevious && offersBack == buttonsBack
    ) {
      return
    }
    buttonsBack = offersBack
    sleepButtonStep = step
    buttonsSkipMs = skipIntervalMs
    buttonsListNext = offersNext
    buttonsListPrevious = offersPrevious
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
    // And the item before it (M119), so the list can be gone back through away from the phone.
    val previous = if (offersPrevious) {
      CommandButton.Builder(CommandButton.ICON_PREVIOUS)
        .setDisplayName(NativeText.t(this, "Previous in list"))
        .setSessionCommand(SessionCommand(Commands.PREVIOUS_IN_LIST, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_OVERFLOW)
        .build()
    } else {
      null
    }
    // For 30 s after a long jump away from the app (M138): Back, in the sleep button's place.
    val undo = if (offersBack) {
      CommandButton.Builder(CommandButton.ICON_UNDEFINED)
        .setCustomIconResId(R.drawable.lelap_go_back)
        .setDisplayName(NativeText.t(this, "Back to where you were"))
        .setSessionCommand(SessionCommand(Commands.GO_BACK, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_OVERFLOW)
        .build()
    } else {
      null
    }
    session.setMediaButtonPreferences(
      if (undo != null) listOfNotNull(back, forward, undo, previous, next) else listOfNotNull(back, forward, previous, next, sleep),
    )
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
        list = following?.title,
        listNext = following?.let { queue.getOrNull(listNext)?.playlist?.title },
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
    // The time left changed: the next tick may now fall inside the fade.
    if (sleepTimer.isRunning) startTicker()
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
    boundaryPublishedAt = SystemClock.elapsedRealtime()
  }

  /** A shake near the end of the timer: ten more minutes, at full volume again. */
  private fun extendSleepTimer() {
    // Extend first: a chapter timer's time left is measured from its boundary.
    sleepTimer.extend(SHAKE_EXTENSION_MS)
    clearBoundary()
    shake.reset()
    placeNow()?.let { (bookId, at) -> record(bookId, PlaybackHistory.TIMER, PlaybackHistory.SHAKE, at, at) }
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
    handler.postDelayed(timerTicker, Battery.sleepTickMs(sleepTimer.remainingMs))
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
      // A real pause, not a stall while buffering: its place goes to the book's server now,
      // not with the next hourly refresh (M123).
      if (!active.playWhenReady && current?.serverPlaces == true) ServerTasks.request(this, ServerTasks.PLACES)
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
    // A seek or the next file: the next chapter mark is somewhere else now.
    retime()
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

  /** Plans the chapter and sleep timer ticks again after a jump or a new speed. */
  private fun retime() {
    if (active.isPlaying) {
      handler.removeCallbacks(chapterTicker)
      handler.post(chapterTicker)
    }
    if (sleepTimer.isRunning) startTicker()
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
      retime()
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
    val r = RemotePlayer(Looper.getMainLooper(), link, ::castRequest, ::onRemoteItemsPicked, ::onRemoteLoaded, ::rewoundPlace, ::renderForCast)
    remote = r
    // Before the first load, so it is rendered when an effect is on.
    castSkipSilence = soundDefaults.with(current?.sound).skipSilence
    applyCastSound(r)
    remoteLink = link
    link.addListener(linkWatcher)
    r.addListener(remoteListener)
    val started = SettableFuture.create<SessionResult>()
    castStart = started
    // Loaded before the swap, so the session never shows an empty player in between.
    r.setBook(items, timelineDurations(), index, position, speed, play = true, outroAtMs = remoteOutroAt())
    // A bedtime routine or a fade under way carries over to the receiver.
    r.setFade(mixer.receiverLevel)
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
      uri = EpisodeFiles.uriFor(file, onMobileData()),
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
    boundaryPublishedAt = SystemClock.elapsedRealtime()
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
            .add(SessionCommand(Commands.PREVIOUS_IN_LIST, Bundle.EMPTY))
            .add(SessionCommand(Commands.GO_BACK, Bundle.EMPTY))
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
        .add(SessionCommand(Commands.PREVIOUS_IN_LIST, Bundle.EMPTY))
        .add(SessionCommand(Commands.GO_BACK, Bundle.EMPTY))
        .build()
      return MediaSession.ConnectionResult.accept(
        commands,
        MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS,
      )
    }

    // Media3 hands headphone and Bluetooth buttons to the player as the notification's controller;
    // mark them so the history says “headphones”. Media3 handles the press itself right after.
    override fun onMediaButtonEvent(
      session: MediaSession,
      controllerInfo: MediaSession.ControllerInfo,
      intent: Intent,
    ): Boolean {
      mediaButtonPressed = true
      handler.post { mediaButtonPressed = false }
      return false
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
        }
        Commands.CANCEL_SLEEP_TIMER -> cancelSleepTimer()
        Commands.CYCLE_SLEEP_TIMER -> {
          mixer.bedtime = 1f
          cycleSleepTimer()
          val source = sourceOf(controller)
          placeNow()?.let { (bookId, at) -> if (source != null) record(bookId, PlaybackHistory.TIMER, source, at, at) }
        }
        Commands.GO_BACK -> goBack(sourceOf(controller))
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
          backOffer.clear()
        }
        Commands.SET_QUEUE -> {
          val json = args.getString(Commands.KEY_QUEUE_JSON).orEmpty()
          val decoded = UpNext.decodeQueue(json)
          following = ListPlay.decode(args.getString(Commands.KEY_LIST_JSON))
          saveQueue(decoded, args.getInt(Commands.KEY_LIST_NEXT, -1).takeIf { it in decoded.indices } ?: -1)
        }
        Commands.NEXT_IN_LIST -> skipToListNext()
        Commands.PREVIOUS_IN_LIST -> skipToListPrevious()
        Commands.START_CAST -> return startRemote()
        Commands.SETTLE_ACCOUNTING -> account()
        Commands.SKIP -> {
          // A player with nothing loaded can't seek; Play would start the book, so load it paused.
          val loaded = player.mediaItemCount == 0 && journalLoad()?.let { loadBook(it, autoplay = false) } != null
          val forward = args.getBoolean(Commands.KEY_FORWARD, true)
          skipBy(if (forward) skipIntervalMs else -skipIntervalMs, sourceOf(controller))
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
          // The app's own load (another book, another profile) ends the offer.
          backOffer.clear()
          handler.removeCallbacks(backExpired)
          loadBook(load, autoplay)
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
      locateStarted(playlist)
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
      picked?.let { CarLibrary.resolveList(it.mediaId, carSnapshot(), journalLoad()) }
        ?.let { return Futures.immediateFuture(carPlayList(it)) }
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
