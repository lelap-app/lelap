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
import androidx.media3.session.SessionResult
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

    AsyncFunction("setSettings") {
        duck: Boolean, skipIntervalMs: Double, smartRewind: Boolean,
        mono: Boolean, voiceEq: Boolean, volumeBoost: Boolean, promise: Promise ->
      withController(promise) { c ->
        val args = Bundle().apply {
          putBoolean(Commands.EXTRA_DUCK, duck)
          putLong(Commands.KEY_SKIP_INTERVAL_MS, skipIntervalMs.toLong())
          putBoolean(Commands.KEY_SMART_REWIND, smartRewind)
          putBoolean(Commands.KEY_MONO, mono)
          putBoolean(Commands.KEY_VOICE_EQ, voiceEq)
          putBoolean(Commands.KEY_VOLUME_BOOST, volumeBoost)
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

    // "chapter" or "episode": stops at the end of the chapter playing, or of the episode.
    AsyncFunction("startSleepTimerAtEnd") { mode: String, promise: Promise ->
      withController(promise) { c ->
        val args = Bundle().apply { putString(Commands.KEY_SLEEP_MODE, mode) }
        c.sendCustomCommand(SessionCommand(Commands.START_SLEEP_TIMER, Bundle.EMPTY), args)
        startTicker()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancelSleepTimer") { promise: Promise ->
      withController(promise) { c ->
        c.sendCustomCommand(SessionCommand(Commands.CANCEL_SLEEP_TIMER, Bundle.EMPTY), Bundle.EMPTY)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setQueue") { queueJson: String, promise: Promise ->
      withController(promise) { c ->
        val args = Bundle().apply { putString(Commands.KEY_QUEUE_JSON, queueJson) }
        c.sendCustomCommand(SessionCommand(Commands.SET_QUEUE, Bundle.EMPTY), args)
      }
    }.runOnQueue(Queues.MAIN)

    // Same process: the places of books the service replaced by itself, oldest first.
    AsyncFunction("takeEarlierPlaces") {
      val prefs = context.getSharedPreferences(Commands.JOURNAL_PREFS, Context.MODE_PRIVATE)
      val list = PositionJournal.decodeEntries(prefs.getString(Commands.EARLIER_KEY, null))
      prefs.edit().remove(Commands.EARLIER_KEY).apply()
      list.map {
        mapOf(
          "bookId" to it.bookId,
          "fileLocation" to it.fileLocation,
          "filePositionMs" to it.filePositionMs.toDouble(),
          "savedAt" to it.savedAt.toDouble(),
        )
      }
    }

    // Same process: what the service heard (M51), for the app to merge, then acknowledge.
    AsyncFunction("takeAccounting") {
      // On disk before the app merges: a record number it has seen must never be handed out again.
      Accounting.edit(context, durable = true) { log ->
        mapOf(
          "epoch" to log.epoch,
          "records" to log.take().map(::recordMap),
        )
      }
    }

    // The service counts up to now (after commands sent before this one), before the app folds.
    AsyncFunction("settleAccounting") { promise: Promise ->
      withController(promise) { c ->
        c.sendCustomCommand(SessionCommand(Commands.SETTLE_ACCOUNTING, Bundle.EMPTY), Bundle.EMPTY)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("ackAccounting") { epoch: String, through: Double ->
      Accounting.edit(context) { it.ack(epoch, through.toLong()) }
    }

    // Same process: the service reads the snapshot when Android Auto browses, app open or not.
    AsyncFunction("setCarLibrary") { json: String ->
      val snapshot = CarLibrary.encode(CarLibrary.decode(json))
      context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE)
        .edit().putString(Commands.PREF_CAR_LIBRARY, snapshot).apply()
    }

    // Same process: the service reads the window whenever playback starts. Null turns it off.
    AsyncFunction("setBedtime") { json: String? ->
      val bedtime = Bedtime.decode(json)
      val edit = context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE).edit()
      if (bedtime == null) edit.remove(Commands.PREF_BEDTIME) else edit.putString(Commands.PREF_BEDTIME, bedtime.encode())
      edit.apply()
    }

    // Same process as the service: the log is read and cleared straight from its preferences.
    AsyncFunction("takeFinished") {
      val prefs = context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE)
      val list = UpNext.decodeFinished(prefs.getString(Commands.PREF_FINISHED, null))
      prefs.edit().remove(Commands.PREF_FINISHED).apply()
      list.map { mapOf("bookId" to it.bookId, "at" to it.at.toDouble()) }
    }

    // Same process: the service logs only while this is on. Off drops what it kept. On the main
    // thread, where the service appends, so an append can't bring a dropped log back.
    AsyncFunction("setDiagnostics") { on: Boolean ->
      val edit = context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean(Commands.PREF_DIAGNOSTICS, on)
      if (!on) edit.remove(Commands.PREF_DIAGNOSTIC_LOG)
      edit.apply()
    }.runOnQueue(Queues.MAIN)

    // Same process: the service's diagnostics events since the last call, oldest first. On the
    // main thread, where the service appends, so no event is lost between the read and the clear.
    AsyncFunction("takeDiagnostics") {
      val prefs = context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE)
      val list = Diagnostics.decode(prefs.getString(Commands.PREF_DIAGNOSTIC_LOG, null))
      prefs.edit().remove(Commands.PREF_DIAGNOSTIC_LOG).apply()
      list.map {
        mapOf(
          "at" to it.at.toDouble(),
          "what" to it.what,
          "code" to it.code,
          "status" to it.status,
          "bookId" to it.bookId,
          "part" to it.part,
        )
      }
    }.runOnQueue(Queues.MAIN)

    // Resolves once the receiver loaded the first file; rejects with the receiver's reason.
    AsyncFunction("castTo") { promise: Promise ->
      val future = connect()
      future.addListener(
        {
          try {
            val result = future.get().sendCustomCommand(SessionCommand(Commands.START_CAST, Bundle.EMPTY), Bundle.EMPTY)
            result.addListener(
              {
                val r = runCatching { result.get() }.getOrNull()
                if (r?.resultCode == SessionResult.RESULT_SUCCESS) {
                  promise.resolve(null)
                } else {
                  promise.reject("ERR_LELAP_CAST", r?.sessionError?.message ?: "Casting failed", null)
                }
              },
              ContextCompat.getMainExecutor(context),
            )
          } catch (e: Exception) {
            promise.reject("ERR_LELAP_AUDIO", e.cause?.message ?: e.message ?: "Player unavailable", e)
          }
        },
        ContextCompat.getMainExecutor(context),
      )
    }.runOnQueue(Queues.MAIN)

    // Hands back to the phone; null plays on here if the receiver was playing.
    AsyncFunction("stopCasting") { resume: Boolean?, promise: Promise ->
      withController(promise) { c ->
        val args = Bundle().apply { resume?.let { putBoolean(Commands.KEY_RESUME, it) } }
        c.sendCustomCommand(SessionCommand(Commands.STOP_CAST, Bundle.EMPTY), args)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("unload") { promise: Promise ->
      withController(promise) { c ->
        c.sendCustomCommand(SessionCommand(Commands.UNLOAD, Bundle.EMPTY), Bundle.EMPTY)
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

  // Numbers as doubles, like the journal: JavaScript has no longs.
  private fun recordMap(record: AccountingRecord): Map<String, Any?> = when (record) {
    is Listened -> mapOf(
      "seq" to record.seq.toDouble(),
      "kind" to "listen",
      "bookId" to record.bookId,
      "title" to record.title,
      "day" to record.day,
      "ms" to record.ms.toDouble(),
    )
    is SessionEvent -> mapOf(
      "seq" to record.seq.toDouble(),
      "kind" to record.kind,
      "bookId" to record.bookId,
      "at" to record.at.toDouble(),
      "fileLocation" to record.fileLocation,
      "filePositionMs" to record.filePositionMs.toDouble(),
      "startLocation" to record.startLocation,
      "startPositionMs" to record.startPositionMs?.toDouble(),
    )
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
        "connected" to false, "playing" to false, "buffering" to false, "ended" to false,
        "bookId" to null, "fileLocation" to null, "bookTitle" to null, "partTitle" to null,
        "partIndex" to -1, "partCount" to 0, "positionMs" to 0.0, "durationMs" to 0.0,
        "speed" to 1.0, "duckOnInterruption" to true, "waitingForCall" to false, "sleepTimerRemainingMs" to null, "sleepTimerMode" to null, "error" to null,
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
      "ended" to (c.playbackState == Player.STATE_ENDED),
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
      "sleepTimerMode" to timerRemaining?.let { extras.getString(Commands.EXTRA_SLEEP_TIMER_MODE) },
      "error" to c.playerError?.let { "${it.errorCodeName}: ${it.message}" },
    )
  }
}
