package app.lelap.audio

import android.media.AudioManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Stands in for ExoPlayer, audio focus and the sleep timer; reports playWhenReady changes back like ExoPlayer. */
private class FakePort : PlaybackRules.Port {
  lateinit var rules: PlaybackRules
  override var playWhenReady = false
  var focusResult = FocusResult.GRANTED
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

  override fun requestFocus(): FocusResult {
    if (focusHeld) return FocusResult.GRANTED
    if (focusResult == FocusResult.GRANTED) focusHeld = true
    return focusResult
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
    rules.interruption = Interruption.PAUSE
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
    rules.interruption = Interruption.PAUSE
    port.play()
    rules.onFocus(FocusAction.PAUSE_TRANSIENT)
    rules.onFocus(FocusAction.PAUSE)
    assertFalse(port.focusHeld)
    rules.onFocus(FocusAction.RESTORE)
    assertFalse(port.playWhenReady)
  }

  @Test fun playDuringCallWithDuckOffWaitsForTheCallToEnd() {
    rules.interruption = Interruption.PAUSE
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
    port.focusResult = FocusResult.FAILED
    port.play()
    assertFalse(port.playWhenReady)
    assertEquals(0, port.timerFrozen)
    assertEquals(0, port.timerResumed)
  }

  // A call that started before Play holds focus with a lock, so Android delays our request.
  @Test fun playDuringACallWithDuckOnPlaysDuckedUntilTheCallEnds() {
    port.focusResult = FocusResult.DELAYED
    port.play()
    assertTrue(port.playWhenReady)
    assertFalse(rules.isWaitingForFocus)
    assertEquals(0.2f, port.duckLevel, 1e-6f)
    assertEquals(1, port.timerResumed)
    port.focusResult = FocusResult.GRANTED
    rules.onFocus(FocusAction.RESTORE)
    assertTrue(port.playWhenReady)
    assertEquals(1f, port.duckLevel, 0f)
  }

  @Test fun pauseDuringADuckedCallStaysPausedAfterIt() {
    port.focusResult = FocusResult.DELAYED
    port.play()
    port.pause()
    assertEquals(1, port.timerFrozen)
    rules.onFocus(FocusAction.RESTORE)
    assertFalse(port.playWhenReady)
    port.play()
    assertEquals(0.2f, port.duckLevel, 1e-6f)
  }

  @Test fun playDuringACallWithDuckOffStartsWhenTheCallEnds() {
    rules.interruption = Interruption.PAUSE
    port.focusResult = FocusResult.DELAYED
    port.play()
    assertFalse(port.playWhenReady)
    assertTrue(rules.isWaitingForFocus)
    assertEquals(0, port.timerResumed)
    port.focusResult = FocusResult.GRANTED
    rules.onFocus(FocusAction.RESTORE)
    assertTrue(port.playWhenReady)
    assertFalse(rules.isWaitingForFocus)
    assertEquals(1, port.timerResumed)
  }

  @Test fun callPauseResumesWhenTheCallEnds() {
    rules.interruption = Interruption.PAUSE
    port.play()
    rules.onFocus(FocusAction.PAUSE_TRANSIENT)
    assertEquals(0, port.timerFrozen)
    rules.onFocus(FocusAction.RESTORE)
    assertTrue(port.playWhenReady)
    assertEquals(1f, port.duckLevel, 0f)
  }

  @Test fun aCallDucksToTheChosenLevelAndRestoresFullVolume() {
    rules.duckLevel = 0.5f
    port.play()
    rules.onFocus(focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, rules.interruption))
    assertTrue(port.playWhenReady)
    assertEquals(0.5f, port.duckLevel, 1e-6f)
    rules.onFocus(FocusAction.RESTORE)
    assertEquals(1f, port.duckLevel, 0f)
  }

  @Test fun playDuringACallDucksToTheChosenLevel() {
    rules.duckLevel = 0.7f
    port.focusResult = FocusResult.DELAYED
    port.play()
    assertTrue(port.playWhenReady)
    assertEquals(0.7f, port.duckLevel, 1e-6f)
    port.focusResult = FocusResult.GRANTED
    rules.onFocus(FocusAction.RESTORE)
    assertEquals(1f, port.duckLevel, 0f)
  }

  @Test fun aNewLevelDuringACallAppliesAtOnceAndNotOutsideOne() {
    rules.duckLevel = 0.6f
    port.play()
    assertEquals(1f, port.duckLevel, 0f)
    rules.onFocus(FocusAction.DUCK)
    rules.duckLevel = 0.3f
    assertEquals(0.3f, port.duckLevel, 1e-6f)
    rules.onFocus(FocusAction.RESTORE)
    rules.duckLevel = 0.9f
    assertEquals(1f, port.duckLevel, 0f)
  }

  @Test fun pauseModePausesForACallAndResumesAtFullVolume() {
    rules.interruption = Interruption.PAUSE
    rules.duckLevel = 0.4f
    port.play()
    rules.onFocus(focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, rules.interruption))
    assertFalse(port.playWhenReady)
    assertEquals(1f, port.duckLevel, 0f)
    rules.onFocus(FocusAction.RESTORE)
    assertTrue(port.playWhenReady)
    assertEquals(1f, port.duckLevel, 0f)
  }

  // Navigation and notifications ask to duck, not to pause; that stays a duck in pause mode too.
  @Test fun pauseModeStillDucksWhenAndroidAsksToDuck() {
    rules.interruption = Interruption.PAUSE
    rules.duckLevel = 0.4f
    port.play()
    rules.onFocus(focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK, rules.interruption))
    assertTrue(port.playWhenReady)
    assertEquals(0.4f, port.duckLevel, 1e-6f)
  }

  @Test fun switchingToDuckDuringAPausedCallPlaysLowered() {
    rules.interruption = Interruption.PAUSE
    port.play()
    rules.onFocus(FocusAction.PAUSE_TRANSIENT)
    rules.interruption = Interruption.DUCK
    port.play()
    assertTrue(port.playWhenReady)
    assertEquals(0.2f, port.duckLevel, 1e-6f)
  }

  @Test fun theOldSwitchKeepsItsMeaning() {
    assertEquals(Interruption.DUCK, interruptionOf(true))
    assertEquals(Interruption.PAUSE, interruptionOf(false))
    // Saved before the level existed: lower to the old fixed 20 %.
    assertEquals(0.2f, duckLevelOf(null), 0f)
    assertEquals(0.2f, PlaybackRules(FakePort()).duckLevel, 0f)
  }

  @Test fun theLevelStaysWithin20To100InStepsOf10() {
    assertEquals(0.2f, duckLevelOf(0f), 0f)
    assertEquals(0.2f, duckLevelOf(Float.NaN), 0f)
    assertEquals(1f, duckLevelOf(1.5f), 0f)
    assertEquals(0.5f, duckLevelOf(0.46f), 1e-6f)
    rules.duckLevel = 0.05f
    assertEquals(0.2f, rules.duckLevel, 0f)
  }

  @Test fun theDuckLevelMultipliesWithTheSleepFadeAndTheBedtimeVolume() {
    var volume = -1f
    val mixer = VolumeMixer { volume = it }
    mixer.duck = 0.6f
    mixer.fade = 0.5f
    assertEquals(0.3f, volume, 1e-6f)
    mixer.bedtime = 0.5f
    assertEquals(0.15f, volume, 1e-6f)
    // At 100 % a call leaves the volume alone; the fade and the bedtime volume still work.
    mixer.duck = 1f
    assertEquals(0.25f, volume, 1e-6f)
  }
}
