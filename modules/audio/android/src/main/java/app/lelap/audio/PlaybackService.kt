package app.lelap.audio

import android.app.PendingIntent
import android.content.Intent
import android.content.SharedPreferences
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import org.json.JSONArray
import org.json.JSONObject
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.util.TimeZone
import androidx.annotation.OptIn
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
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.PlayerMessage
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

private const val TIMER_TICK_MS = 250L
private const val CHAPTER_TICK_MS = 1_000L
// A chapter or episode timer's end moves with seeks and speed; the app hears it this often.
private const val BOUNDARY_PUBLISH_TICKS = 20

@OptIn(UnstableApi::class)
private const val PAUSE_SETTLE_MS = 500L

class PlaybackService : MediaLibraryService() {
  private lateinit var player: ExoPlayer
  private lateinit var session: MediaLibrarySession
  private lateinit var focus: AudioFocus
  private lateinit var mixer: VolumeMixer
  private lateinit var sleepTimer: SleepTimer
  private lateinit var rules: PlaybackRules

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
  private val shakeListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent) {
      val (x, y, z) = event.values
      if (sleepTimer.acceptsShake && shake.onSample(x, y, z)) extendSleepTimer()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  }

  private val handler = Handler(Looper.getMainLooper())
  private val sound = SoundChain()
  private val prefs by lazy { getSharedPreferences(Commands.AUDIO_PREFS, MODE_PRIVATE) }
  private val journalPrefs by lazy { getSharedPreferences(Commands.JOURNAL_PREFS, MODE_PRIVATE) }

  /** The loaded book, kept for the journal and playback resumption. */
  private var current: BookPlaylist? = null
    set(value) {
      field = value
      // Only this book's own files get its server's login, never another host.
      headersByUri = value?.takeIf { it.headers.isNotEmpty() }
        ?.let { book -> book.files.associate { file -> file.uri to book.headers } }
        .orEmpty()
    }

  @Volatile private var headersByUri: Map<String, Map<String, String>> = emptyMap()

  private fun withBookHeaders(upstream: DataSource.Factory): DataSource.Factory =
    ResolvingDataSource.Factory(upstream) { spec ->
      headersByUri[spec.uri.toString()]?.let(spec::withAdditionalHeaders) ?: spec
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
  private var queue: List<BookLoad> = emptyList()

  private var skipIntervalMs = 30_000L
  private var smartRewind = true

  /** Wall-clock time of the last pause, for smart rewind; null once Play has used it. */
  private var pausedAt: Long? = null

  // When playback or a seek last moved the place. Loading a book does not move it, so the journal
  // carries this time rather than the write time: a stale place loaded here must not outrank a
  // newer one synced from another device.
  private var placeChangedAt = 0L

  private val chapterTicker = object : Runnable {
    override fun run() {
      updateChapterTitle()
      if (player.isPlaying) handler.postDelayed(this, CHAPTER_TICK_MS)
    }
  }

  // ExoPlayer reports the pause before its position settles (about 1.7 s early on the test phone),
  // so the journal is written once more shortly after.
  private val pauseSettled = Runnable {
    if (!player.isPlaying) writeJournal(PositionJournal.Event.PAUSE)
  }

  private val journalTicker = object : Runnable {
    override fun run() {
      placeChangedAt = System.currentTimeMillis()
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
    player = ExoPlayer.Builder(this, SoundRenderersFactory(this, SoundProcessor(sound)))
      .setMediaSourceFactory(
        DefaultMediaSourceFactory(withBookHeaders(DefaultDataSource.Factory(this, http)))
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
      onVolume = { mixer.fade = it },
      onFinished = {
        clearBoundary()
        rules.onSleepTimerFinished()
        publishExtras()
      },
    )
    focus = AudioFocus(this) {
      Diagnostics.focusEvent(it)?.let { what -> note(what) }
      rules.onFocus(it)
      publishExtras()
    }
    rules = PlaybackRules(Port()).apply {
      duckOnInterruption = prefs.getBoolean(Commands.EXTRA_DUCK, true)
    }
    skipIntervalMs = prefs.getLong(Commands.KEY_SKIP_INTERVAL_MS, 30_000L)
    smartRewind = prefs.getBoolean(Commands.KEY_SMART_REWIND, true)
    sound.mono = prefs.getBoolean(Commands.KEY_MONO, false)
    sound.voiceEq = prefs.getBoolean(Commands.KEY_VOICE_EQ, false)
    sound.boost = prefs.getBoolean(Commands.KEY_VOLUME_BOOST, false)
    focus.duckOnInterruption = rules.duckOnInterruption
    queue = UpNext.decodeQueue(prefs.getString(Commands.PREF_QUEUE, null))
    player.addListener(object : Player.Listener {
      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        Diagnostics.pauseEvent(playWhenReady, reason)?.let { note(it, code = reason) }
        if (playWhenReady) rewindAfterPause() else pausedAt = System.currentTimeMillis()
        rules.onPlayWhenReadyChanged(playWhenReady)
        if (playWhenReady) startBedtimeTimer()
        publishExtras()
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
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
        // Replacing an item's metadata reports a transition too; only real ones are journaled.
        if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) {
          placeChangedAt = System.currentTimeMillis()
          writeJournal(PositionJournal.Event.ITEM_CHANGE)
        }
      }

      override fun onPositionDiscontinuity(
        oldPosition: Player.PositionInfo,
        newPosition: Player.PositionInfo,
        reason: Int,
      ) {
        if (reason == Player.DISCONTINUITY_REASON_SEEK) {
          placeChangedAt = System.currentTimeMillis()
          writeJournal(PositionJournal.Event.SEEK)
          updateChapterTitle()
          // A seek into another chapter moves a chapter timer to that chapter's end.
          if (sleepBoundaryMs != null) {
            placeBoundary()
            publishExtras()
          }
        }
      }

      override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
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
    session = builder.build()
    prefs.registerOnSharedPreferenceChangeListener(carListener)
    publishExtras()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

  override fun onTaskRemoved(rootIntent: Intent?) {
    writeJournal(PositionJournal.Event.TASK_REMOVED)
    // Keep playing when the app is swiped away; nothing to keep alive when paused.
    if (!player.playWhenReady || player.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    writeJournal(PositionJournal.Event.DESTROY)
    publishNowPlaying(stopping = true)
    handler.removeCallbacks(journalTicker)
    handler.removeCallbacks(chapterTicker)
    handler.removeCallbacks(timerTicker)
    handler.removeCallbacks(pauseSettled)
    sleepTimer.cancel()
    clearBoundary()
    stopShakeListening()
    prefs.unregisterOnSharedPreferenceChangeListener(carListener)
    focus.abandon()
    session.release()
    player.release()
    super.onDestroy()
  }

  /** The book played to its end: log it, then hand over to Up Next if it is an episode. */
  private fun onBookEnded() {
    val ended = current ?: return
    val log = UpNext.decodeFinished(prefs.getString(Commands.PREF_FINISHED, null)) +
      Finished(ended.bookId, System.currentTimeMillis())
    prefs.edit().putString(Commands.PREF_FINISHED, UpNext.encodeFinished(log.takeLast(100))).apply()
    // A timer for the end of the episode (or of the last chapter) stops here, before Up Next.
    if (sleepBoundaryMs != null) {
      sleepTimer.finish()
      return
    }
    val (next, rest) = UpNext.afterEnd(currentHandsOver, queue)
    if (next == null) return
    queue = rest
    prefs.edit().putString(Commands.PREF_QUEUE, encodeQueue(rest)).apply()
    loadBook(next, autoplay = true)
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
    currentHandsOver = load.handsOver
    // The book that is already loaded keeps its live place, which is newer than any saved one.
    if (PositionJournal.isSameBook(current, player.mediaItemCount, load)) {
      // A changed intro or outro for the show applies to the episode that is loaded.
      val loaded = current
      if (loaded != null && (loaded.introMs != playlist.introMs || loaded.outroMs != playlist.outroMs)) {
        current = loaded.copy(introMs = playlist.introMs, outroMs = playlist.outroMs)
        placeOutro()
      }
      if (autoplay) player.play()
      return
    }
    if (!autoplay) player.pause()
    keepEarlierPlace(playlist.bookId)
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
    player.setMediaItems(mediaItems(playlist), index, position)
    player.setPlaybackSpeed(playlist.speed.coerceIn(0.5f, 3f))
    player.prepare()
    // A chapter timer carries over to the new book's chapter.
    placeBoundary()
    if (autoplay) player.play()
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
    val (entry, _) = journalPrefs.getString(Commands.JOURNAL_KEY, null)?.let(PositionJournal::decode) ?: return
    if (entry.bookId != playing.bookId) return
    journalPrefs.edit()
      .putString(Commands.EARLIER_KEY, PositionJournal.appendEarlier(journalPrefs.getString(Commands.EARLIER_KEY, null), entry))
      .apply()
  }

  private fun carSnapshot(): CarSnapshot = CarLibrary.decode(prefs.getString(Commands.PREF_CAR_LIBRARY, null))

  private fun journalLoad(): BookLoad? = journalPrefs.getString(Commands.JOURNAL_KEY, null)
    ?.let(PositionJournal::decode)
    ?.let { (entry, playlist) -> CarLibrary.journalLoad(entry, playlist) }

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
        player.currentMediaItemIndex,
        player.currentPosition,
      )
    }
    keepEarlierPlace(playlist.bookId)
    current = playlist
    currentHandsOver = load.handsOver
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
          .setArtworkUri(playlist.coverUri?.let(Uri::parse))
          .setTrackNumber(index + 1)
          .setTotalTrackCount(playlist.files.size)
          .setExtras(Bundle().apply { putString(Commands.METADATA_BOOK_ID, playlist.bookId) })
          .build(),
      )
      .build()
  }

  private fun rewindAfterPause() {
    val since = pausedAt ?: return
    pausedAt = null
    if (!smartRewind || player.mediaItemCount == 0) return
    val rewind = SeekRules.rewindOnResume(System.currentTimeMillis() - since)
    if (rewind <= 0) return
    val index = player.currentMediaItemIndex
    val position = player.currentPosition
    // Never across a file start, and not back into a skipped intro once past it; a listener who
    // went back into the intro on purpose stays there.
    val intro = current?.introMs?.takeIf { position >= it } ?: 0L
    player.seekTo(index, SeekRules.trimmedStart(index, position, rewind, intro))
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

  private fun skipBy(deltaMs: Long) {
    if (player.mediaItemCount == 0) return
    val (index, position) = SeekRules.skip(player.currentMediaItemIndex, player.currentPosition, deltaMs, durations())
    player.seekTo(index, position)
  }

  private fun chapterTitleAt(playlist: BookPlaylist, index: Int, positionMs: Long): String? {
    if (playlist.chapters.isEmpty()) return null
    val bookPosition = playlist.files.take(index).sumOf { it.durationMs.coerceAtLeast(0L) } + positionMs
    return playlist.chapters.lastOrNull { it.startMs <= bookPosition }?.title
  }

  /** Shows the current chapter as the title on the notification and lock screen. */
  private fun updateChapterTitle() {
    val playlist = current ?: return
    val index = player.currentMediaItemIndex
    val item = player.currentMediaItem ?: return
    val title = chapterTitleAt(playlist, index, player.currentPosition) ?: return
    if (item.mediaMetadata.title?.toString() == title) return
    // Same URI, so ExoPlayer swaps the metadata without interrupting playback.
    player.replaceMediaItem(index, item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setTitle(title).build()).build())
  }

  /** The session's player: previous and next skip by the skip interval, across files. */
  private inner class SkippingPlayer : ForwardingPlayer(player) {
    private val skipCommands = intArrayOf(
      Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_NEXT,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD,
    )

    override fun getAvailableCommands(): Player.Commands {
      val commands = super.getAvailableCommands()
      if (player.mediaItemCount == 0) return commands
      return commands.buildUpon().addAll(*skipCommands).build()
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
    val entry = PositionJournal.entryFor(
      playlist,
      player.currentMediaItemIndex,
      player.currentMediaItem?.mediaId,
      player.currentPosition,
      placeChangedAt,
    ) ?: return
    // Every write restarts the 10 s tick, so writes are never more than 10 s apart while playing.
    handler.removeCallbacks(journalTicker)
    if (player.isPlaying) handler.postDelayed(journalTicker, PositionJournal.TICK_INTERVAL_MS)
    val editor = journalPrefs.edit().putString(Commands.JOURNAL_KEY, PositionJournal.encode(entry, playlist))
    // The process may die right after these two; write them synchronously.
    if (event == PositionJournal.Event.TASK_REMOVED || event == PositionJournal.Event.DESTROY) editor.commit() else editor.apply()
  }

  private fun cancelSleepTimer() {
    if (!sleepTimer.isActive) return
    handler.removeCallbacks(timerTicker)
    sleepTimer.cancel()
    clearBoundary()
    publishExtras()
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
    if (step == sleepButtonStep && skipIntervalMs == buttonsSkipMs) return
    sleepButtonStep = step
    buttonsSkipMs = skipIntervalMs
    val seconds = skipIntervalMs / 1_000L
    val back = CommandButton.Builder(SkipIcons.back(skipIntervalMs))
      .setPlayerCommand(Player.COMMAND_SEEK_BACK)
      .setDisplayName("Back $seconds seconds")
      .setSlots(CommandButton.SLOT_BACK)
      .build()
    val forward = CommandButton.Builder(SkipIcons.forward(skipIntervalMs))
      .setPlayerCommand(Player.COMMAND_SEEK_FORWARD)
      .setDisplayName("Forward $seconds seconds")
      .setSlots(CommandButton.SLOT_FORWARD)
      .build()
    val sleep = CommandButton.Builder(CommandButton.ICON_UNDEFINED)
      .setCustomIconResId(if (step == SleepStep.OFF) R.drawable.lelap_sleep_timer_off else R.drawable.lelap_sleep_timer_on)
      .setDisplayName(SleepCycle.label(step))
      .setSessionCommand(SessionCommand(Commands.CYCLE_SLEEP_TIMER, Bundle.EMPTY))
      .setSlots(CommandButton.SLOT_OVERFLOW)
      .build()
    session.setMediaButtonPreferences(listOf(back, forward, sleep))
  }

  /** Starts the bedtime timer when Play falls inside the window the app set; once per night. */
  private fun startBedtimeTimer() {
    val bedtime = Bedtime.decode(prefs.getString(Commands.PREF_BEDTIME, null)) ?: return
    val now = System.currentTimeMillis()
    val (day, minute) = Bedtime.localClock(now, TimeZone.getDefault().getOffset(now))
    val lastNight = if (prefs.contains(Commands.PREF_BEDTIME_NIGHT)) prefs.getLong(Commands.PREF_BEDTIME_NIGHT, 0L) else null
    val night = Bedtime.nightToMark(bedtime, day, minute, lastNight) ?: return
    // A timer the listener set first counts as tonight's, so turning it off later keeps it off.
    prefs.edit().putLong(Commands.PREF_BEDTIME_NIGHT, night).apply()
    if (sleepTimer.isActive) return
    sleepPressed = null
    if (bedtime.chapter) startSleepTimer(SleepMode.CHAPTER, 0L) else startSleepTimer(SleepMode.MINUTES, bedtime.minutes * 60_000L)
  }

  /** Saves what plays now for the widget and tile, and tells them; only when it changed. */
  private fun publishNowPlaying(stopping: Boolean = false) {
    val playlist = current
    // A service the widget woke that never loaded a book leaves the last one on the widget.
    if (playlist == null && lastNowPlaying == null) return
    val metadata = player.mediaMetadata
    val encoded = if (playlist == null || player.mediaItemCount == 0) {
      NowPlaying.NOTHING
    } else {
      NowPlaying(
        bookId = playlist.bookId,
        title = playlist.title,
        chapter = metadata.title?.toString()?.takeIf { it != playlist.title },
        author = playlist.author,
        coverUri = playlist.coverUri,
        playing = !stopping && player.playWhenReady && player.playbackState != Player.STATE_ENDED,
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
    if (!player.playWhenReady) sleepTimer.freeze() else startTicker()
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
    SleepBoundary.bookPosition(player.currentMediaItemIndex, player.currentPosition, durations)

  private fun untilBoundary(): Long {
    val boundary = sleepBoundaryMs ?: return 0L
    return SleepBoundary.remainingMs(boundary, bookPositionNow(timelineDurations()), player.playbackParameters.speed)
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
    publishExtras()
  }

  // The accelerometer is only on while a shake would count, so it costs nothing otherwise. It
  // needs no permission; ExoPlayer's wake lock keeps it reporting with the screen off.
  private fun updateShakeListening() {
    if (sleepTimer.acceptsShake) startShakeListening() else stopShakeListening()
  }

  private fun startShakeListening() {
    if (listeningForShake) return
    val accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
    shake.reset()
    listeningForShake = sensors.registerListener(shakeListener, accelerometer, SensorManager.SENSOR_DELAY_GAME)
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

  private inner class Port : PlaybackRules.Port {
    override val playWhenReady: Boolean
      get() = player.playWhenReady

    override fun pause() = player.pause()

    override fun play() = player.play()

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
        putBoolean(Commands.EXTRA_DUCK, focus.duckOnInterruption)
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
          rules.duckOnInterruption = duck
          focus.duckOnInterruption = duck
          skipIntervalMs = args.getLong(Commands.KEY_SKIP_INTERVAL_MS, 30_000L).coerceIn(5_000L, 300_000L)
          smartRewind = args.getBoolean(Commands.KEY_SMART_REWIND, true)
          sound.mono = args.getBoolean(Commands.KEY_MONO, false)
          sound.voiceEq = args.getBoolean(Commands.KEY_VOICE_EQ, false)
          sound.boost = args.getBoolean(Commands.KEY_VOLUME_BOOST, false)
          prefs.edit()
            .putBoolean(Commands.EXTRA_DUCK, duck)
            .putLong(Commands.KEY_SKIP_INTERVAL_MS, skipIntervalMs)
            .putBoolean(Commands.KEY_SMART_REWIND, smartRewind)
            .putBoolean(Commands.KEY_MONO, sound.mono)
            .putBoolean(Commands.KEY_VOICE_EQ, sound.voiceEq)
            .putBoolean(Commands.KEY_VOLUME_BOOST, sound.boost)
            .apply()
        }
        Commands.START_SLEEP_TIMER -> {
          val mode = SleepMode.fromWire(args.getString(Commands.KEY_SLEEP_MODE)) ?: SleepMode.MINUTES
          sleepPressed = null
          startSleepTimer(mode, args.getLong(Commands.KEY_DURATION_MS))
        }
        Commands.CANCEL_SLEEP_TIMER -> cancelSleepTimer()
        Commands.CYCLE_SLEEP_TIMER -> cycleSleepTimer()
        // Another profile is listening now and has nothing to play: clear the lock screen and
        // notification. The place was journaled at the pause before this.
        Commands.UNLOAD -> {
          writeJournal(PositionJournal.Event.PAUSE)
          handler.removeCallbacks(pauseSettled)
          player.pause()
          cancelSleepTimer()
          player.clearMediaItems()
          current = null
        }
        Commands.SET_QUEUE -> {
          val json = args.getString(Commands.KEY_QUEUE_JSON).orEmpty()
          queue = UpNext.decodeQueue(json)
          prefs.edit().putString(Commands.PREF_QUEUE, encodeQueue(queue)).apply()
        }
        Commands.LOAD_BOOK -> {
          val load = PositionJournal.decodeLoad(args.getString(Commands.KEY_BOOK_JSON).orEmpty())
            ?: return Futures.immediateFuture(SessionResult(SessionError.ERROR_BAD_VALUE))
          loadBook(load, args.getBoolean(Commands.KEY_AUTOPLAY, false))
        }
        else -> return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
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
      val (entry, playlist) = journalPrefs.getString(Commands.JOURNAL_KEY, null)?.let(PositionJournal::decode)
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
      val start = SeekRules.startPosition(index, entry.filePositionMs, entry.savedAt, System.currentTimeMillis(), smartRewind, playlist.introMs)
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
      val nodes = CarLibrary.children(parentId, carSnapshot(), journalLoad())
        ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
      val from = (page.toLong() * pageSize).coerceAtMost(nodes.size.toLong()).toInt()
      val to = (from.toLong() + pageSize).coerceAtMost(nodes.size.toLong()).toInt()
      return Futures.immediateFuture(
        LibraryResult.ofItemList(ImmutableList.copyOf(nodes.subList(from, to).map(::carItem)), params),
      )
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val node = CarLibrary.item(mediaId, carSnapshot(), journalLoad())
        ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
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
