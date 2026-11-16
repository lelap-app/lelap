package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class SeekRulesTest {
  @Test
  fun doesNotRewindAfterAShortPause() {
    assertEquals(0L, SeekRules.rewindOnResume(59_999))
  }

  @Test
  fun rewindsFiveSecondsAfterAMinuteUpToAnHour() {
    assertEquals(5_000L, SeekRules.rewindOnResume(60_000))
    assertEquals(5_000L, SeekRules.rewindOnResume(3_600_000))
  }

  @Test
  fun rewindsFifteenSecondsAfterMoreThanAnHour() {
    assertEquals(15_000L, SeekRules.rewindOnResume(3_600_001))
  }

  @Test
  fun neverRewindsForANegativePause() {
    assertEquals(0L, SeekRules.rewindOnResume(-5))
  }

  private val durations = listOf(60_000L, 60_000L, 60_000L)

  @Test
  fun skipsWithinAFile() {
    assertEquals(1 to 40_000L, SeekRules.skip(1, 10_000, 30_000, durations))
    assertEquals(1 to 0L, SeekRules.skip(1, 30_000, -30_000, durations))
  }

  @Test
  fun skipsBackIntoThePreviousFile() {
    assertEquals(0 to 40_000L, SeekRules.skip(1, 10_000, -30_000, durations))
  }

  @Test
  fun skipsForwardIntoTheNextFile() {
    assertEquals(2 to 10_000L, SeekRules.skip(1, 40_000, 30_000, durations))
  }

  @Test
  fun stopsAtTheStartAndEndOfTheBook() {
    assertEquals(0 to 0L, SeekRules.skip(0, 10_000, -30_000, durations))
    assertEquals(2 to 60_000L, SeekRules.skip(2, 50_000, 30_000, durations))
  }

  @Test
  fun staysInTheFileWhenADurationIsUnknown() {
    assertEquals(1 to 0L, SeekRules.skip(1, 10_000, -30_000, listOf(0L, 60_000L)))
    assertEquals(0 to 70_000L, SeekRules.skip(0, 40_000, 30_000, listOf(0L, 60_000L)))
  }

  @Test
  fun rewindsTheStartOfABookPlayedAfterAPause() {
    assertEquals(95_000L, SeekRules.resumePosition(100_000, pausedAt = 0, now = 120_000, smartRewind = true))
    assertEquals(100_000L, SeekRules.resumePosition(100_000, pausedAt = 0, now = 120_000, smartRewind = false))
    assertEquals(100_000L, SeekRules.resumePosition(100_000, pausedAt = null, now = 120_000, smartRewind = true))
    assertEquals(0L, SeekRules.resumePosition(2_000, pausedAt = 0, now = 10_000_000, smartRewind = true))
  }
}
