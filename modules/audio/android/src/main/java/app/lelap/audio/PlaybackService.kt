package app.lelap.audio

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

private const val TIMER_TICK_MS = 250L
private const val CHAPTER_TICK_MS = 1_000L

@OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {
  private lateinit var player: ExoPlayer
  private lateinit var session: MediaLibrarySession
  private lateinit var focus: AudioFocus
  private lateinit var mixer: VolumeMixer
  private lateinit var sleepTimer: SleepTimer
  private lateinit var rules: PlaybackRules

  private val handler = Handler(Looper.getMainLooper())
  private val prefs by lazy { getSharedPreferences(Commands.AUDIO_PREFS, MODE_PRIVATE) }
  private val journalPrefs by lazy { getSharedPreferences(Commands.JOURNAL_PREFS, MODE_PRIVATE) }

  /** The loaded book, kept for the journal and playback resumption. */
  private var current: BookPlaylist? = null

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

  private val journalTicker = object : Runnable {
    override fun run() {
      placeChangedAt = System.currentTimeMillis()
      writeJournal(PositionJournal.Event.TICK)
    }
  }

  private val timerTicker = object : Runnable {
    override fun run() {
      sleepTimer.tick()
      if (sleepTimer.isRunning) handler.postDelayed(this, TIMER_TICK_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    val http = DefaultHttpDataSource.Factory()
      .setUserAgent("Lelap")
      // archive.org redirects downloads to mirror hosts, sometimes across protocols.
      .setAllowCrossProtocolRedirects(true)
    player = ExoPlayer.Builder(this)
      .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http)))
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
        rules.onSleepTimerFinished()
        publishExtras()
      },
    )
    focus = AudioFocus(this) {
      rules.onFocus(it)
      publishExtras()
    }
    rules = PlaybackRules(Port()).apply {
      duckOnInterruption = prefs.getBoolean(Commands.EXTRA_DUCK, true)
    }
    skipIntervalMs = prefs.getLong(Commands.KEY_SKIP_INTERVAL_MS, 30_000L)
    smartRewind = prefs.getBoolean(Commands.KEY_SMART_REWIND, true)
    focus.duckOnInterruption = rules.duckOnInterruption
    player.addListener(object : Player.Listener {
      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        if (playWhenReady) rewindAfterPause() else pausedAt = System.currentTimeMillis()
        rules.onPlayWhenReadyChanged(playWhenReady)
        publishExtras()
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        handler.removeCallbacks(journalTicker)
        handler.removeCallbacks(chapterTicker)
        if (isPlaying) {
          handler.postDelayed(journalTicker, PositionJournal.TICK_INTERVAL_MS)
          handler.post(chapterTicker)
        } else {
          placeChangedAt = System.currentTimeMillis()
          writeJournal(PositionJournal.Event.PAUSE)
        }
      }

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
        }
      }
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
    handler.removeCallbacks(journalTicker)
    handler.removeCallbacks(chapterTicker)
    handler.removeCallbacks(timerTicker)
    sleepTimer.cancel()
    focus.abandon()
    session.release()
    player.release()
    super.onDestroy()
  }

  private fun loadBook(load: BookLoad, autoplay: Boolean) {
    val playlist = load.playlist
    // The book that is already loaded keeps its live place, which is newer than any saved one.
    if (PositionJournal.isSameBook(current, player.mediaItemCount, load)) {
      if (autoplay) player.play()
      return
    }
    if (!autoplay) player.pause()
    current = playlist
    val start = load.startPositionMs.coerceAtLeast(0L)
    val position = if (autoplay) SeekRules.resumePosition(start, load.pausedAt, System.currentTimeMillis(), smartRewind) else start
    pausedAt = if (autoplay) null else load.pausedAt
    placeChangedAt = load.pausedAt ?: 0L
    player.setMediaItems(
      mediaItems(playlist),
      load.startIndex.coerceIn(0, playlist.files.lastIndex),
      position,
    )
    player.setPlaybackSpeed(playlist.speed.coerceIn(0.5f, 3f))
    player.prepare()
    if (autoplay) player.play()
    writeJournal(PositionJournal.Event.ITEM_CHANGE)
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
    // Never across a file start: the rewind stays inside the file that is playing.
    if (rewind > 0) player.seekTo(player.currentMediaItemIndex, (player.currentPosition - rewind).coerceAtLeast(0L))
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
    publishExtras()
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
      sleepTimer.resume()
      startTicker()
      publishExtras()
    }
  }

  private fun publishExtras() {
    if (!::session.isInitialized) return
    session.setSessionExtras(
      Bundle().apply {
        putBoolean(Commands.EXTRA_DUCK, focus.duckOnInterruption)
        putBoolean(Commands.EXTRA_WAITING_FOR_FOCUS, rules.isWaitingForFocus)
        sleepTimer.endsAtMs?.let { putLong(Commands.EXTRA_SLEEP_TIMER_END, it) }
        if (!sleepTimer.isRunning) {
          sleepTimer.remainingMs?.let { putLong(Commands.EXTRA_SLEEP_TIMER_FROZEN, it) }
        }
      },
    )
  }

  private inner class Callback : MediaLibrarySession.Callback {
    override fun onConnect(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
    ): MediaSession.ConnectionResult {
      val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
        .add(SessionCommand(Commands.SET_SETTINGS, Bundle.EMPTY))
        .add(SessionCommand(Commands.START_SLEEP_TIMER, Bundle.EMPTY))
        .add(SessionCommand(Commands.CANCEL_SLEEP_TIMER, Bundle.EMPTY))
        .add(SessionCommand(Commands.LOAD_BOOK, Bundle.EMPTY))
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
          prefs.edit()
            .putBoolean(Commands.EXTRA_DUCK, duck)
            .putLong(Commands.KEY_SKIP_INTERVAL_MS, skipIntervalMs)
            .putBoolean(Commands.KEY_SMART_REWIND, smartRewind)
            .apply()
        }
        Commands.START_SLEEP_TIMER -> {
          sleepTimer.start(args.getLong(Commands.KEY_DURATION_MS))
          // Set while paused, the timer waits for Play like one the user paused.
          if (!player.playWhenReady) sleepTimer.freeze() else startTicker()
        }
        Commands.CANCEL_SLEEP_TIMER -> cancelSleepTimer()
        Commands.LOAD_BOOK -> {
          val load = PositionJournal.decodeLoad(args.getString(Commands.KEY_BOOK_JSON).orEmpty())
            ?: return Futures.immediateFuture(SessionResult(SessionError.ERROR_BAD_VALUE))
          loadBook(load, args.getBoolean(Commands.KEY_AUTOPLAY, false))
        }
        else -> return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
      }
      publishExtras()
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
      val start = SeekRules.resumePosition(entry.filePositionMs, entry.savedAt, System.currentTimeMillis(), smartRewind)
      return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(mediaItems(playlist), index, start))
    }

    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val root = MediaItem.Builder()
        .setMediaId("root")
        .setMediaMetadata(
          MediaMetadata.Builder().setIsBrowsable(true).setIsPlayable(false).build(),
        )
        .build()
      return Futures.immediateFuture(LibraryResult.ofItem(root, params))
    }
  }
}
