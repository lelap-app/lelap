package app.lelap.audio

/** What a call or another transient loss does to playback; the listener chooses. */
enum class Interruption { PAUSE, DUCK }

/** The fixed level before it became a setting, and still the default. */
const val DEFAULT_DUCK_LEVEL = 0.2f
private const val MIN_DUCK_LEVEL = 0.2f

/** Only a switch was stored before the level: on meant ducking to 20 %, off meant pausing. */
fun interruptionOf(duck: Boolean): Interruption = if (duck) Interruption.DUCK else Interruption.PAUSE

/** A stored or received level, kept to 20–100 % in steps of 10; a missing one is 20 %. */
fun duckLevelOf(level: Float?): Float {
  if (level == null || level.isNaN()) return DEFAULT_DUCK_LEVEL
  return Math.round(level.coerceIn(MIN_DUCK_LEVEL, 1f) * 10f) / 10f
}

/**
 * Decides what playback does on user play/pause, audio focus changes and the end of the sleep timer.
 * ExoPlayer reports every pause the same way, so pauses we cause ourselves are marked beforehand
 * to tell them apart from the user's.
 */
class PlaybackRules(private val port: Port) {
  interface Port {
    val playWhenReady: Boolean
    fun pause()
    fun play()
    fun requestFocus(): FocusResult
    fun abandonFocus()
    fun setDuck(level: Float)
    fun freezeSleepTimer()
    fun resumeSleepTimer()
  }

  var interruption = Interruption.DUCK

  /** The volume while ducked; Android's own duck requests (navigation) use it in either mode. */
  var duckLevel = DEFAULT_DUCK_LEVEL
    set(value) {
      field = duckLevelOf(value)
      // A new level chosen during a call applies at once.
      if (ducked) port.setDuck(field)
    }

  private var ducked = false

  // A transient loss (call, VoIP, navigation) is under way and focus will come back.
  private var transientLoss = false

  // Playback was paused by a transient loss, or the user asked to play during one.
  private var resumeOnGain = false

  /** Play was asked for during a call; it starts when focus comes back. */
  val isWaitingForFocus: Boolean
    get() = resumeOnGain

  // The next pause is ours, not the user's.
  private var expectingPause = false

  fun onPlayWhenReadyChanged(playWhenReady: Boolean) {
    if (!playWhenReady) {
      if (expectingPause) {
        expectingPause = false
        return
      }
      resumeOnGain = false
      port.freezeSleepTimer()
      abandonFocus()
      return
    }
    if (transientLoss) {
      // Play during a call: ducked if that is the setting, otherwise wait for the call to end.
      if (interruption == Interruption.DUCK) {
        // The call may have paused us before the listener switched to lowering the volume.
        duck(true)
        port.resumeSleepTimer()
      } else {
        resumeOnGain = true
        pauseInternally()
      }
      return
    }
    resumeOnGain = false
    when (port.requestFocus()) {
      FocusResult.GRANTED -> {
        duck(false)
        port.resumeSleepTimer()
      }
      // A call holds focus, so Android grants ours when it ends. Duck until then, or wait.
      FocusResult.DELAYED ->
        if (interruption == Interruption.DUCK) {
          transientLoss = true
          duck(true)
          port.resumeSleepTimer()
        } else {
          resumeOnGain = true
          pauseInternally()
        }
      FocusResult.FAILED -> pauseInternally()
    }
  }

  fun onFocus(action: FocusAction) {
    when (action) {
      FocusAction.PAUSE -> {
        resumeOnGain = false
        duck(false)
        pauseInternally()
        abandonFocus()
      }
      FocusAction.PAUSE_TRANSIENT -> {
        transientLoss = true
        if (port.playWhenReady) {
          resumeOnGain = true
          pauseInternally()
        }
      }
      FocusAction.DUCK -> {
        transientLoss = true
        duck(true)
      }
      FocusAction.RESTORE -> {
        transientLoss = false
        duck(false)
        if (resumeOnGain) {
          resumeOnGain = false
          port.play()
        }
      }
    }
  }

  fun onSleepTimerFinished() {
    resumeOnGain = false
    pauseInternally()
    abandonFocus()
  }

  private fun duck(on: Boolean) {
    ducked = on
    port.setDuck(if (on) duckLevel else 1f)
  }

  private fun pauseInternally() {
    if (!port.playWhenReady) return
    expectingPause = true
    port.pause()
  }

  private fun abandonFocus() {
    transientLoss = false
    port.abandonFocus()
  }
}
