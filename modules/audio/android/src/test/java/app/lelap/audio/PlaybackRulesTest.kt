package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stands in for ExoPlayer, audio focus and the sleep timer; reports playWhenReady changes back like ExoPlayer. */
private class FakePort : PlaybackRules.Port {
  lateinit var rules: PlaybackRules
  override var playWhenReady = false
  var focusGranted = true
  var focusHeld = false
  var duckLevel = 1f
  var timerFrozen = 0
  var timerResumed = 0

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

  override fun freezeSleepTimer() {
    timerFrozen++
  }

  override fun resumeSleepTimer() {
    timerResumed++
  }
}

class PlaybackRulesTest {
  private val port = FakePort()
  private val rules = PlaybackRules(port).also { port.rules = it }

  @Test fun userPauseFreezesSleepTimerAndAbandonsFocus() {
    port.play()
    port.pause()
    assertEquals(1, port.timerFrozen)
    assertFalse(port.focusHeld)
  }

  @Test fun userPlayResumesSleepTimer() {
    port.play()
    port.pause()
    port.play()
    assertEquals(2, port.timerResumed)
  }

  @Test fun sleepTimerFinishingDuringCallPauseDoesNotResumeAfterCall() {
    rules.duckOnInterruption = false
    port.play()
    rules.onFocus(FocusAction.PAUSE_TRANSIENT)
    assertFalse(port.playWhenReady)
    rules.onSleepTimerFinished()
    rules.onFocus(FocusAction.RESTORE)
    assertFalse(port.playWhenReady)
    assertFalse(port.focusHeld)
  }

  @Test fun sleepTimerFinishingPausesWithoutCountingAsUserPause() {
    port.play()
    rules.onSleepTimerFinished()
    assertFalse(port.playWhenReady)
    assertFalse(port.focusHeld)
    assertEquals(0, port.timerFrozen)
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
    assertEquals(1, port.timerResumed)
    rules.onFocus(FocusAction.RESTORE)
    assertTrue(port.playWhenReady)
    assertEquals(2, port.timerResumed)
  }

  @Test fun playDuringDuckedCallStaysDucked() {
    port.play()
    rules.onFocus(FocusAction.DUCK)
    port.playWhenReady = false
    port.play()
    assertTrue(port.playWhenReady)
    assertEquals(0.2f, port.duckLevel, 1e-6f)
  }

  @Test fun deniedFocusPausesWithoutTouchingSleepTimer() {
    port.focusGranted = false
    port.play()
    assertFalse(port.playWhenReady)
    assertEquals(0, port.timerFrozen)
    assertEquals(0, port.timerResumed)
  }

  @Test fun callPauseResumesWhenTheCallEnds() {
    rules.duckOnInterruption = false
    port.play()
    rules.onFocus(FocusAction.PAUSE_TRANSIENT)
    assertEquals(0, port.timerFrozen)
    rules.onFocus(FocusAction.RESTORE)
    assertTrue(port.playWhenReady)
    assertEquals(1f, port.duckLevel, 0f)
  }
}
