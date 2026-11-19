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
import app.lelap.text.NativeText
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val STATE_EVENT = "onStateChange"

/** Bridges JavaScript to [PlaybackService] through a MediaController on the main thread. */
class AudioModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private var controller: MediaController? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  // In the background nothing shows the moving position, so the app hears it every 10 s instead of
  // every second (M106): its own saves need no more, and the service keeps the place itself.
  private var inBackground = false

  private val ticker = object : Runnable {
    override fun run() {
      emit()
      if (controller?.isPlaying == true) handler.postDelayed(this, Battery.stateTickMs(inBackground))
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
      val args = Bundle().apply {
        putString(Commands.KEY_BOOK_JSON, bookJson)
        putBoolean(Commands.KEY_AUTOPLAY, autoplay)
      }
      sendCommand(promise, Commands.LOAD_BOOK, args)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { index: Int, positionMs: Double, promise: Promise ->
      withController(promise) { c ->
        if (index in 0 until c.mediaItemCount) c.seekTo(index, positionMs.toLong().coerceAtLeast(0L))
      }
    }.runOnQueue(Queues.MAIN)

    // Same process as the service, so the journal is read straight from its preferences.
    // Written by the service every few seconds while it plays, in this same process.
    AsyncFunction("silenceSavedMs") { bookId: String ->
      val json = context.getSharedPreferences(Commands.SILENCE_PREFS, Context.MODE_PRIVATE)
        .getString(Commands.SILENCE_KEY, null)
      SilenceSavings.decode(json).savedMs(bookId).toDouble()
    }

    AsyncFunction("takeJournal") {
      val json = context.getSharedPreferences(Commands.JOURNAL_PREFS, Context.MODE_PRIVATE)
        .getString(Commands.JOURNAL_KEY, null)
      val entry = PositionJournal.decodeEntry(json) ?: return@AsyncFunction null
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
        duck: Boolean, duckLevel: Double, skipIntervalMs: Double, smartRewind: Boolean,
        sound: Map<String, Boolean>, promise: Promise ->
      val args = Bundle().apply {
        putBoolean(Commands.EXTRA_DUCK, duck)
        putFloat(Commands.KEY_DUCK_LEVEL, duckLevel.toFloat())
        putLong(Commands.KEY_SKIP_INTERVAL_MS, skipIntervalMs.toLong())
        putBoolean(Commands.KEY_SMART_REWIND, smartRewind)
        // The switches come as one map: Expo functions take at most eight arguments.
        for (key in listOf(
          Commands.KEY_MONO, Commands.KEY_VOICE_EQ, Commands.KEY_VOLUME_BOOST,
          Commands.KEY_SKIP_SILENCE, Commands.KEY_EVEN_LOUDNESS,
        )) {
          putBoolean(key, sound[key] == true)
        }
        putBoolean(Commands.KEY_SHAKE_TO_EXTEND, sound[Commands.KEY_SHAKE_TO_EXTEND] != false)
      }
      sendCommand(promise, Commands.SET_SETTINGS, args)
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
      val args = Bundle().apply { putLong(Commands.KEY_DURATION_MS, (minutes * 60_000).toLong()) }
      sendCommand(promise, Commands.START_SLEEP_TIMER, args, then = ::startTicker)
    }.runOnQueue(Queues.MAIN)

    // "chapter" or "episode": stops at the end of the chapter playing, or of the episode.
    AsyncFunction("startSleepTimerAtEnd") { mode: String, promise: Promise ->
      val args = Bundle().apply { putString(Commands.KEY_SLEEP_MODE, mode) }
      sendCommand(promise, Commands.START_SLEEP_TIMER, args, then = ::startTicker)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancelSleepTimer") { promise: Promise ->
      sendCommand(promise, Commands.CANCEL_SLEEP_TIMER)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setQueue") { queueJson: String, listNext: Int, promise: Promise ->
      val args = Bundle().apply {
        putString(Commands.KEY_QUEUE_JSON, queueJson)
        putInt(Commands.KEY_LIST_NEXT, listNext)
      }
      sendCommand(promise, Commands.SET_QUEUE, args)
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
      sendCommand(promise, Commands.SETTLE_ACCOUNTING)
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

    // Same process: the service reads the window whenever playback starts, and the alarm wakes it
    // when the window opens. Null turns it off.
    AsyncFunction("setBedtime") { json: String? ->
      val bedtime = Bedtime.decode(json)
      val edit = context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE).edit()
      if (bedtime == null) edit.remove(Commands.PREF_BEDTIME) else edit.putString(Commands.PREF_BEDTIME, bedtime.encode())
      // Written before the alarm reads it.
      edit.commit()
      BedtimeAlarm.schedule(context)
    }

    // Same process: where the timer last stopped playback, and where the listener last used the player.
    AsyncFunction("getSleepPlace") {
      val prefs = context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE)
      SleepPlace.decode(prefs.getString(Commands.PREF_SLEEP_PLACE, null))?.let {
        mapOf(
          "bookId" to it.bookId,
          "stoppedMs" to it.stoppedMs.toDouble(),
          "stoppedAt" to it.stoppedAt.toDouble(),
          "usedMs" to it.usedMs?.toDouble(),
          "usedAt" to it.usedAt?.toDouble(),
        )
      }
    }

    AsyncFunction("clearSleepPlace") {
      context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE)
        .edit().remove(Commands.PREF_SLEEP_PLACE).apply()
    }

    // Same process as the service: the log is read and cleared straight from its preferences.
    AsyncFunction("takeFinished") {
      val prefs = context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE)
      val list = UpNext.decodeFinished(prefs.getString(Commands.PREF_FINISHED, null))
      prefs.edit().remove(Commands.PREF_FINISHED).apply()
      list.map {
        mapOf(
          "bookId" to it.bookId,
          "at" to it.at.toDouble(),
          "startLocation" to it.startLocation,
          "startPositionMs" to it.startPositionMs?.toDouble(),
        )
      }
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
      sendCommand(promise, Commands.START_CAST, code = "ERR_LELAP_CAST", fallback = "Casting failed")
    }.runOnQueue(Queues.MAIN)

    // Hands back to the phone; null plays on here if the receiver was playing.
    AsyncFunction("stopCasting") { resume: Boolean?, promise: Promise ->
      val args = Bundle().apply { resume?.let { putBoolean(Commands.KEY_RESUME, it) } }
      sendCommand(promise, Commands.STOP_CAST, args)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("unload") { promise: Promise ->
      sendCommand(promise, Commands.UNLOAD)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getState") { promise: Promise ->
      connect().addListener({ promise.resolve(state()) }, ContextCompat.getMainExecutor(context))
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      handler.post { inBackground = true }
    }

    OnActivityEntersForeground {
      handler.post {
        inBackground = false
        // At once, so the screen shows the place the moment it is back.
        if (controller != null) startTicker()
      }
    }

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

  /**
   * Sends a custom command and settles [promise] with the service's answer, so a refusal (a book
   * it could not read) reaches JavaScript. [then] runs on success before the promise resolves.
   */
  private fun sendCommand(
    promise: Promise,
    action: String,
    args: Bundle = Bundle.EMPTY,
    code: String = "ERR_LELAP_AUDIO",
    fallback: String = "The player refused the command",
    then: () -> Unit = {},
  ) {
    val future = connect()
    future.addListener(
      {
        try {
          val result = future.get().sendCustomCommand(SessionCommand(action, Bundle.EMPTY), args)
          result.addListener(
            {
              val r = runCatching { result.get() }.getOrNull()
              val failure = Commands.failure(r?.resultCode, r?.sessionError?.message, fallback)
              if (failure == null) {
                then()
                promise.resolve(null)
              } else {
                promise.reject(code, failure, null)
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
      "error" to c.playerError?.let { PlayerErrors.text(it.errorCode, it.message, NativeText.get(context)) },
    )
  }
}
