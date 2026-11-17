package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class SleepBoundaryTest {
  // Three files of 10 minutes; chapters at 0, 4 and 25 minutes.
  private val durations = listOf(600_000L, 600_000L, 600_000L)
  private val chapters = listOf(0L, 240_000L, 1_500_000L)

  @Test fun chapterEndsAtTheNextMark() {
    assertEquals(240_000L, SleepBoundary.boundaryMs(SleepMode.CHAPTER, 10_000, chapters, durations))
    assertEquals(1_500_000L, SleepBoundary.boundaryMs(SleepMode.CHAPTER, 240_000, chapters, durations))
  }

  @Test fun lastChapterEndsWithTheBook() {
    assertEquals(1_800_000L, SleepBoundary.boundaryMs(SleepMode.CHAPTER, 1_600_000, chapters, durations))
  }

  @Test fun withoutChaptersTheFileEndIsTheBoundary() {
    assertEquals(1_200_000L, SleepBoundary.boundaryMs(SleepMode.CHAPTER, 700_000, emptyList(), durations))
    assertEquals(600_000L, SleepBoundary.boundaryMs(SleepMode.CHAPTER, 0, listOf(0L), durations))
  }

  @Test fun episodeEndsWithTheBook() {
    assertEquals(1_800_000L, SleepBoundary.boundaryMs(SleepMode.EPISODE, 10_000, chapters, durations))
  }

  @Test fun fileTargetInsideAFile() {
    assertEquals(FileTarget(0, 240_000, false), SleepBoundary.fileTarget(240_000, durations))
    assertEquals(FileTarget(2, 300_000, false), SleepBoundary.fileTarget(1_500_000, durations))
  }

  @Test fun fileTargetOnAFileEndBelongsToThatFile() {
    assertEquals(FileTarget(1, 600_000, true), SleepBoundary.fileTarget(1_200_000, durations))
    assertEquals(FileTarget(2, 600_000, true), SleepBoundary.fileTarget(1_800_000, durations))
  }

  @Test fun remainingFollowsSpeedAndGoesNegativePastTheEnd() {
    assertEquals(60_000L, SleepBoundary.remainingMs(240_000, 180_000, 1f))
    assertEquals(30_000L, SleepBoundary.remainingMs(240_000, 180_000, 2f))
    assertEquals(-2_000L, SleepBoundary.remainingMs(240_000, 242_000, 1f))
  }

  @Test fun bookPositionAddsEarlierFiles() {
    assertEquals(1_230_000L, SleepBoundary.bookPosition(2, 30_000, durations))
  }

  @Test fun modeWireNames() {
    assertEquals(SleepMode.CHAPTER, SleepMode.fromWire("chapter"))
    assertEquals(SleepMode.EPISODE, SleepMode.fromWire("episode"))
    assertEquals(null, SleepMode.fromWire("bogus"))
  }
}
