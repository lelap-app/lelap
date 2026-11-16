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
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
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

private const val PREFS = "lelap_audio"
private const val TIMER_TICK_MS = 250L

@OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {
  private lateinit var player: ExoPlayer
  private lateinit var session: MediaLibrarySession
  private lateinit var focus: AudioFocus
  private lateinit var mixer: VolumeMixer
  private lateinit var sleepTimer: SleepTimer
  private lateinit var rules: PlaybackRules

  private val handler = Handler(Looper.getMainLooper())
  private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }
  private val journalPrefs by lazy { getSharedPreferences(Commands.JOURNAL_PREFS, MODE_PRIVATE) }

  /** The loaded book, kept for the journal and playback resumption. */
  private var current: BookPlaylist? = null
  private var lastJournalAt = Long.MIN_VALUE / 2

  private val journalTicker = object : Runnable {
    override fun run() {
      writeJournal(PositionJournal.Event.TICK)
      if (player.isPlaying) handler.postDelayed(this, PositionJournal.TICK_INTERVAL_MS)
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
    focus.duckOnInterruption = rules.duckOnInterruption
    player.addListener(object : Player.Listener {
      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        rules.onPlayWhenReadyChanged(playWhenReady)
        publishExtras()
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        handler.removeCallbacks(journalTicker)
        if (isPlaying) {
          handler.postDelayed(journalTicker, PositionJournal.TICK_INTERVAL_MS)
        } else {
          writeJournal(PositionJournal.Event.PAUSE)
        }
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) =
        writeJournal(PositionJournal.Event.ITEM_CHANGE)

      override fun onPositionDiscontinuity(
        oldPosition: Player.PositionInfo,
        newPosition: Player.PositionInfo,
        reason: Int,
      ) {
        if (reason == Player.DISCONTINUITY_REASON_SEEK) writeJournal(PositionJournal.Event.SEEK)
      }
    })

    val builder = MediaLibrarySession.Builder(this, player, Callback())
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
    handler.removeCallbacks(timerTicker)
    sleepTimer.cancel()
    focus.abandon()
    session.release()
    player.release()
    super.onDestroy()
  }

  private fun loadBook(load: BookLoad, autoplay: Boolean) {
    val playlist = load.playlist
    require(playlist.files.isNotEmpty()) { "A book needs at least one file" }
    current = playlist
    player.setMediaItems(
      mediaItems(playlist),
      load.startIndex.coerceIn(0, playlist.files.lastIndex),
      load.startPositionMs.coerceAtLeast(0L),
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
          .setTitle(file.title)
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

  /** Records the place; must never throw, since it runs from lifecycle callbacks. */
  private fun writeJournal(event: PositionJournal.Event) {
    val playlist = current ?: return
    if (player.mediaItemCount == 0) return
    val now = SystemClock.elapsedRealtime()
    if (!PositionJournal.shouldWrite(lastJournalAt, now, event)) return
    val file = playlist.files.getOrNull(player.currentMediaItemIndex) ?: return
    val entry = JournalEntry(playlist.bookId, file.location, player.currentPosition.coerceAtLeast(0L), System.currentTimeMillis())
    val editor = journalPrefs.edit().putString(Commands.JOURNAL_KEY, PositionJournal.encode(entry, playlist))
    // The process may die right after these two; write them synchronously.
    if (event == PositionJournal.Event.TASK_REMOVED || event == PositionJournal.Event.DESTROY) editor.commit() else editor.apply()
    lastJournalAt = now
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
        .add(SessionCommand(Commands.SET_DUCK, Bundle.EMPTY))
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
        Commands.SET_DUCK -> {
          val enabled = args.getBoolean(Commands.KEY_ENABLED, true)
          rules.duckOnInterruption = enabled
          focus.duckOnInterruption = enabled
          prefs.edit().putBoolean(Commands.EXTRA_DUCK, enabled).apply()
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
      current = playlist
      player.setPlaybackSpeed(playlist.speed.coerceIn(0.5f, 3f))
      val index = playlist.files.indexOfFirst { it.location == entry.fileLocation }.coerceAtLeast(0)
      return Futures.immediateFuture(
        MediaSession.MediaItemsWithStartPosition(mediaItems(playlist), index, entry.filePositionMs),
      )
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
