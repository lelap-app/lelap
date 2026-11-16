package app.lelap.audio

import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val STATE_EVENT = "onStateChange"
private const val TICK_MS = 1_000L

/** Bridges JavaScript to [PlaybackService] through a MediaController on the main thread. */
class AudioModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private var controller: MediaController? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val ticker = object : Runnable {
    override fun run() {
      emit()
      if (controller?.isPlaying == true) handler.postDelayed(this, TICK_MS)
    }
  }

  private val playerListener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) = emit()

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (isPlaying) startTicker()
    }
  }

  override fun definition() = ModuleDefinition {
    Name("LelapAudio")
    Events(STATE_EVENT)

    // The book travels as JSON so the service can decode it with the same code as its journal.
    AsyncFunction("load") { bookJson: String, autoplay: Boolean, promise: Promise ->
      withController(promise) { c ->
        val args = Bundle().apply {
          putString(Commands.KEY_BOOK_JSON, bookJson)
          putBoolean(Commands.KEY_AUTOPLAY, autoplay)
        }
        c.sendCustomCommand(SessionCommand(Commands.LOAD_BOOK, Bundle.EMPTY), args)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { index: Int, positionMs: Double, promise: Promise ->
      withController(promise) { c ->
        if (index in 0 until c.mediaItemCount) c.seekTo(index, positionMs.toLong().coerceAtLeast(0L))
      }
    }.runOnQueue(Queues.MAIN)

    // Same process as the service, so the journal is read straight from its preferences.
    AsyncFunction("takeJournal") {
      val json = context.getSharedPreferences(Commands.JOURNAL_PREFS, Context.MODE_PRIVATE)
        .getString(Commands.JOURNAL_KEY, null) ?: return@AsyncFunction null
      val (entry, _) = PositionJournal.decode(json) ?: return@AsyncFunction null
      mapOf(
        "bookId" to entry.bookId,
        "fileLocation" to entry.fileLocation,
        "filePositionMs" to entry.filePositionMs.toDouble(),
        "savedAt" to entry.savedAt.toDouble(),
      )
    }

    AsyncFunction("play") { promise: Promise ->
      withController(promise) { c ->
        // After an error the player is idle; prepare again so Play retries.
        if (c.playbackState == Player.STATE_IDLE) c.prepare()
        c.play()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { promise: Promise ->
      withController(promise) { it.pause() }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekBy") { deltaMs: Double, promise: Promise ->
      withController(promise) { c ->
        c.seekTo((c.currentPosition + deltaMs.toLong()).coerceAtLeast(0L))
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("skipToPart") { index: Int, promise: Promise ->
      withController(promise) { c ->
        if (index in 0 until c.mediaItemCount) c.seekTo(index, 0L)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setSpeed") { speed: Float, promise: Promise ->
      // setPlaybackSpeed keeps pitch at 1.0, so voices do not chipmunk.
      withController(promise) { it.setPlaybackSpeed(speed.coerceIn(0.5f, 3f)) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setSettings") { duck: Boolean, skipIntervalMs: Double, smartRewind: Boolean, promise: Promise ->
      withController(promise) { c ->
        val args = Bundle().apply {
          putBoolean(Commands.EXTRA_DUCK, duck)
          putLong(Commands.KEY_SKIP_INTERVAL_MS, skipIntervalMs.toLong())
          putBoolean(Commands.KEY_SMART_REWIND, smartRewind)
        }
        c.sendCustomCommand(SessionCommand(Commands.SET_SETTINGS, Bundle.EMPTY), args)
      }
    }.runOnQueue(Queues.MAIN)

    // Computed here and sent as a plain seek: the session gates seekToNext by ExoPlayer's own
    // commands (none on the last file), and a plain seek is masked correctly by the controller.
    AsyncFunction("skip") { forward: Boolean, promise: Promise ->
      withController(promise) { c ->
        if (c.mediaItemCount == 0) return@withController
        val interval = context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE)
          .getLong(Commands.KEY_SKIP_INTERVAL_MS, 30_000L)
        val durations = List(c.mediaItemCount) { i ->
          val timeline = c.currentTimeline
          val known = if (i < timeline.windowCount) timeline.getWindow(i, Timeline.Window()).durationMs else C.TIME_UNSET
          if (known == C.TIME_UNSET) 0L else known
        }
        val (index, position) = SeekRules.skip(c.currentMediaItemIndex, c.currentPosition, if (forward) interval else -interval, durations)
        c.seekTo(index, position)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startSleepTimer") { minutes: Double, promise: Promise ->
      withController(promise) { c ->
        val args = Bundle().apply { putLong(Commands.KEY_DURATION_MS, (minutes * 60_000).toLong()) }
        c.sendCustomCommand(SessionCommand(Commands.START_SLEEP_TIMER, Bundle.EMPTY), args)
        startTicker()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancelSleepTimer") { promise: Promise ->
      withController(promise) { c ->
        c.sendCustomCommand(SessionCommand(Commands.CANCEL_SLEEP_TIMER, Bundle.EMPTY), Bundle.EMPTY)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getState") { promise: Promise ->
      connect().addListener({ promise.resolve(state()) }, ContextCompat.getMainExecutor(context))
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      handler.post {
        handler.removeCallbacks(ticker)
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        controller = null
      }
    }
  }

  private fun withController(promise: Promise, block: (MediaController) -> Unit) {
    val future = connect()
    future.addListener(
      {
        try {
          block(future.get())
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("ERR_LELAP_AUDIO", e.cause?.message ?: e.message ?: "Player unavailable", e)
        }
      },
      ContextCompat.getMainExecutor(context),
    )
  }

  private fun connect(): ListenableFuture<MediaController> {
    controllerFuture?.let { return it }
    val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
    val future = MediaController.Builder(context, token)
      .setListener(object : MediaController.Listener {
        override fun onExtrasChanged(controller: MediaController, extras: Bundle) = emit()

        override fun onDisconnected(controller: MediaController) {
          this@AudioModule.controller = null
          controllerFuture = null
          emit()
        }
      })
      .buildAsync()
    controllerFuture = future
    future.addListener(
      {
        try {
          val c = future.get()
          controller = c
          c.addListener(playerListener)
          emit()
          if (c.isPlaying) startTicker()
        } catch (e: Exception) {
          controllerFuture = null
        }
      },
      ContextCompat.getMainExecutor(context),
    )
    return future
  }

  private fun startTicker() {
    handler.removeCallbacks(ticker)
    handler.post(ticker)
  }

  private fun emit() = sendEvent(STATE_EVENT, state())

  private fun state(): Map<String, Any?> {
    val c = controller
    if (c == null || !c.isConnected) {
      return mapOf(
        "connected" to false, "playing" to false, "buffering" to false,
        "bookId" to null, "fileLocation" to null, "bookTitle" to null, "partTitle" to null,
        "partIndex" to -1, "partCount" to 0, "positionMs" to 0.0, "durationMs" to 0.0,
        "speed" to 1.0, "duckOnInterruption" to true, "waitingForCall" to false, "sleepTimerRemainingMs" to null, "error" to null,
      )
    }
    val extras = c.sessionExtras
    val timerRemaining = when {
      extras.containsKey(Commands.EXTRA_SLEEP_TIMER_END) ->
        (extras.getLong(Commands.EXTRA_SLEEP_TIMER_END) - SystemClock.elapsedRealtime()).coerceAtLeast(0L)
      extras.containsKey(Commands.EXTRA_SLEEP_TIMER_FROZEN) -> extras.getLong(Commands.EXTRA_SLEEP_TIMER_FROZEN)
      else -> null
    }
    val duration = c.duration
    return mapOf(
      "connected" to true,
      "playing" to c.isPlaying,
      "buffering" to (c.playbackState == Player.STATE_BUFFERING),
      "bookId" to c.mediaMetadata.extras?.getString(Commands.METADATA_BOOK_ID),
      "fileLocation" to c.currentMediaItem?.mediaId,
      "bookTitle" to c.mediaMetadata.albumTitle?.toString(),
      "partTitle" to c.mediaMetadata.title?.toString(),
      "partIndex" to if (c.mediaItemCount == 0) -1 else c.currentMediaItemIndex,
      "partCount" to c.mediaItemCount,
      "positionMs" to c.currentPosition.toDouble(),
      "durationMs" to if (duration == C.TIME_UNSET) 0.0 else duration.toDouble(),
      "speed" to c.playbackParameters.speed.toDouble(),
      "duckOnInterruption" to extras.getBoolean(Commands.EXTRA_DUCK, true),
      "waitingForCall" to extras.getBoolean(Commands.EXTRA_WAITING_FOR_FOCUS, false),
      "sleepTimerRemainingMs" to timerRemaining?.toDouble(),
      "error" to c.playerError?.let { "${it.errorCodeName}: ${it.message}" },
    )
  }
}
