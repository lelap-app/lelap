package app.lelap.audio

private const val DUCK_VOLUME = 0.2f

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

  var duckOnInterruption = true

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
      if (duckOnInterruption) {
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
        port.setDuck(1f)
        port.resumeSleepTimer()
      }
      FocusResult.DELAYED -> {
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
        port.setDuck(1f)
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
        port.setDuck(DUCK_VOLUME)
      }
      FocusAction.RESTORE -> {
        transientLoss = false
        port.setDuck(1f)
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
