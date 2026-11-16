package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stands in for ExoPlayer, audio focus and Lull; reports playWhenReady changes back like ExoPlayer. */
private class FakePort : PlaybackRules.Port {
  lateinit var rules: PlaybackRules
  override var playWhenReady = false
  var focusGranted = true
  var focusHeld = false
  var duckLevel = 1f
  var lullCancelled = 0

  override fun pause() {
    if (!playWhenReady) return
    playWhenReady = false
    rules.onPlayWhenReadyChanged(false)
  }

  override fun play() {
    if (playWhenReady) return
    playWhenReady = true
    rules.onPlayWhenReadyChanged(true)
  }

  override fun requestFocus(): Boolean {
    if (focusGranted) focusHeld = true
    return focusHeld
  }

  override fun abandonFocus() {
    focusHeld = false
  }

  override fun setDuck(level: Float) {
    duckLevel = level
  }

  override fun cancelLull() {
    lullCancelled++
  }
}

class PlaybackRulesTest {
  private val port = FakePort()
  private val rules = PlaybackRules(port).also { port.rules = it }

  @Test fun userPauseCancelsLullAndAbandonsFocus() {
    port.play()
    port.pause()
    assertEquals(1, port.lullCancelled)
    assertFalse(port.focusHeld)
  }

  @Test fun lullFinishingDuringCallPauseDoesNotResumeAfterCall() {
    rules.duckOnInterruption = false
    port.play()
    rules.onFocus(FocusAction.PAUSE_TRANSIENT)
    assertFalse(port.playWhenReady)
    rules.onLullFinished()
    rules.onFocus(FocusAction.RESTORE)
    assertFalse(port.playWhenReady)
    assertFalse(port.focusHeld)
  }

  @Test fun lullFinishingPausesWithoutCountingAsUserPause() {
    port.play()
    rules.onLullFinished()
    assertFalse(port.playWhenReady)
    assertFalse(port.focusHeld)
    assertEquals(0, port.lullCancelled)
  }

  @Test fun permanentLossAfterCallPauseAbandonsFocus() {
    rules.duckOnInterruption = false
    port.play()
    rules.onFocus(FocusAction.PAUSE_TRANSIENT)
    rules.onFocus(FocusAction.PAUSE)
    assertFalse(port.focusHeld)
    rules.onFocus(FocusAction.RESTORE)
    assertFalse(port.playWhenReady)
  }

  @Test fun playDuringCallWithDuckOffWaitsForTheCallToEnd() {
    rules.duckOnInterruption = false
    port.play()
    rules.onFocus(FocusAction.PAUSE_TRANSIENT)
    port.play()
    assertFalse(port.playWhenReady)
    assertEquals(1f, port.duckLevel, 0f)
    rules.onFocus(FocusAction.RESTORE)
    assertTrue(port.playWhenReady)
  }

  @Test fun playDuringDuckedCallStaysDucked() {
    port.play()
    rules.onFocus(FocusAction.DUCK)
    port.playWhenReady = false
    port.play()
    assertTrue(port.playWhenReady)
    assertEquals(0.2f, port.duckLevel, 1e-6f)
  }

  @Test fun deniedFocusPausesWithoutCancellingLull() {
    port.focusGranted = false
    port.play()
    assertFalse(port.playWhenReady)
    assertEquals(0, port.lullCancelled)
  }

  @Test fun callPauseResumesWhenTheCallEnds() {
    rules.duckOnInterruption = false
    port.play()
    rules.onFocus(FocusAction.PAUSE_TRANSIENT)
    assertEquals(0, port.lullCancelled)
    rules.onFocus(FocusAction.RESTORE)
    assertTrue(port.playWhenReady)
    assertEquals(1f, port.duckLevel, 0f)
  }
}
