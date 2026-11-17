package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class SleepCycleTest {
  @Test fun cyclesFifteenThirtyChapterOff() {
    var step = SleepStep.OFF
    val seen = List(4) { step = SleepCycle.next(step); step }
    assertEquals(listOf(SleepStep.MIN_15, SleepStep.MIN_30, SleepStep.CHAPTER, SleepStep.OFF), seen)
  }

  @Test fun aTimerSetInTheAppTurnsOff() {
    assertEquals(SleepStep.OTHER, SleepCycle.current(true, SleepMode.MINUTES, null))
    assertEquals(SleepStep.OTHER, SleepCycle.current(true, SleepMode.EPISODE, null))
    assertEquals(SleepStep.OFF, SleepCycle.next(SleepStep.OTHER))
  }

  @Test fun followsTheTimerItStarted() {
    assertEquals(SleepStep.MIN_30, SleepCycle.current(true, SleepMode.MINUTES, SleepStep.MIN_30))
    assertEquals(SleepStep.CHAPTER, SleepCycle.current(true, SleepMode.CHAPTER, SleepStep.CHAPTER))
  }

  @Test fun aFinishedOrCancelledTimerIsOff() {
    assertEquals(SleepStep.OFF, SleepCycle.current(false, null, SleepStep.MIN_15))
    assertEquals(SleepStep.OFF, SleepCycle.current(false, SleepMode.MINUTES, SleepStep.MIN_15))
  }

  @Test fun aShakeTurnsAChapterTimerIntoMinutesThatTheNextPressEnds() {
    assertEquals(SleepStep.OTHER, SleepCycle.current(true, SleepMode.MINUTES, SleepStep.CHAPTER))
  }

  @Test fun labelsSayWhatIsSet() {
    assertEquals("Sleep timer off", SleepCycle.label(SleepStep.OFF))
    assertEquals("Sleep timer end of chapter", SleepCycle.label(SleepStep.CHAPTER))
  }
}
