package app.lelap.audio

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class PartRecord : Record {
  @Field val url: String = ""
  @Field val title: String = ""
}

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

    AsyncFunction("load") { bookTitle: String, parts: List<PartRecord>, startIndex: Int, promise: Promise ->
      withController(promise) { c ->
        require(parts.isNotEmpty()) { "A book needs at least one part" }
        val items = parts.mapIndexed { index, part -> mediaItem(bookTitle, part, index, parts.size) }
        c.setMediaItems(items, startIndex.coerceIn(0, items.lastIndex), 0L)
        c.prepare()
      }
    }.runOnQueue(Queues.MAIN)

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

    AsyncFunction("setDuckOnInterruption") { enabled: Boolean, promise: Promise ->
      withController(promise) { c ->
        val args = Bundle().apply { putBoolean(Commands.KEY_ENABLED, enabled) }
        c.sendCustomCommand(SessionCommand(Commands.SET_DUCK, Bundle.EMPTY), args)
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
        "bookTitle" to null, "partTitle" to null,
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

  private fun mediaItem(bookTitle: String, part: PartRecord, index: Int, count: Int): MediaItem {
    val uri = Uri.parse(part.url)
    return MediaItem.Builder()
      .setMediaId(part.url)
      .setUri(uri)
      // The URI itself does not cross to the session; PlaybackService rebuilds it from here.
      .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(uri).build())
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle(part.title)
          .setAlbumTitle(bookTitle)
          .setTrackNumber(index + 1)
          .setTotalTrackCount(count)
          .build(),
      )
      .build()
  }
}
