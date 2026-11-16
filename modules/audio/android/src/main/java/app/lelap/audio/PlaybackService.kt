package app.lelap.audio

import android.app.PendingIntent
import android.content.Intent
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
private const val LULL_TICK_MS = 250L

@OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {
  private lateinit var player: ExoPlayer
  private lateinit var session: MediaLibrarySession
  private lateinit var focus: AudioFocus
  private lateinit var mixer: VolumeMixer
  private lateinit var lull: Lull
  private lateinit var rules: PlaybackRules

  private val handler = Handler(Looper.getMainLooper())
  private val prefs by lazy { getSharedPreferences(PREFS, MODE_PRIVATE) }

  private val lullTicker = object : Runnable {
    override fun run() {
      lull.tick()
      if (lull.endsAtMs != null) handler.postDelayed(this, LULL_TICK_MS)
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
    lull = Lull(
      clock = SystemClock::elapsedRealtime,
      onVolume = { mixer.lull = it },
      onFinished = {
        rules.onLullFinished()
        publishExtras()
      },
    )
    focus = AudioFocus(this) { rules.onFocus(it) }
    rules = PlaybackRules(Port()).apply {
      duckOnInterruption = prefs.getBoolean(Commands.EXTRA_DUCK, true)
    }
    focus.duckOnInterruption = rules.duckOnInterruption
    player.addListener(object : Player.Listener {
      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) =
        rules.onPlayWhenReadyChanged(playWhenReady)
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
    // Keep playing when the app is swiped away; nothing to keep alive when paused.
    if (!player.playWhenReady || player.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    handler.removeCallbacks(lullTicker)
    lull.cancel()
    focus.abandon()
    session.release()
    player.release()
    super.onDestroy()
  }

  private fun cancelLull() {
    if (lull.endsAtMs == null) return
    handler.removeCallbacks(lullTicker)
    lull.cancel()
    publishExtras()
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

    override fun cancelLull() = this@PlaybackService.cancelLull()
  }

  private fun publishExtras() {
    session.setSessionExtras(
      Bundle().apply {
        putBoolean(Commands.EXTRA_DUCK, focus.duckOnInterruption)
        lull.endsAtMs?.let { putLong(Commands.EXTRA_LULL_END, it) }
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
        .add(SessionCommand(Commands.START_LULL, Bundle.EMPTY))
        .add(SessionCommand(Commands.CANCEL_LULL, Bundle.EMPTY))
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
        Commands.START_LULL -> {
          lull.start(args.getLong(Commands.KEY_DURATION_MS))
          handler.removeCallbacks(lullTicker)
          handler.postDelayed(lullTicker, LULL_TICK_MS)
        }
        Commands.CANCEL_LULL -> cancelLull()
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
