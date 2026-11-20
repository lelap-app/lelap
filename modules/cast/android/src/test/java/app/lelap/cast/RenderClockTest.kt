package app.lelap.cast

import org.junit.Assert.assertEquals
import org.junit.Test

class RenderClockTest {
  @Test
  fun beforeAnyMarkTheStreamStartsAtThePlace() {
    val clock = RenderClock(90_000L)
    assertEquals(90_000L, clock.mediaAt(0L))
    assertEquals(91_500L, clock.mediaAt(1_500L))
  }

  @Test
  fun aSkippedPauseAndSpeedMapBackToThePart() {
    val clock = RenderClock(10_000L)
    // 1.5x: 1 s of stream is 1.5 s of the part; then 2 s of silence left out.
    clock.mark(1_000L, 11_500L)
    clock.mark(2_000L, 13_000L)
    clock.mark(2_010L, 15_015L)
    clock.mark(3_000L, 16_500L)
    assertEquals(10_750L, clock.mediaAt(500L))
    assertEquals(12_250L, clock.mediaAt(1_500L))
    assertEquals(15_757L, clock.mediaAt(2_505L))
    // Past the last mark, straight on.
    assertEquals(17_500L, clock.mediaAt(4_000L))
  }

  @Test
  fun aSecondFetchAddsOnlyWhatIsNew() {
    val clock = RenderClock(0L)
    clock.mark(1_000L, 1_000L)
    clock.mark(2_000L, 3_000L)
    clock.mark(1_000L, 1_000L)
    clock.mark(2_000L, 3_000L)
    assertEquals(2, clock.marks)
  }

  @Test
  fun skipSilencesTimeComesFromTheMarks() {
    val clock = RenderClock(10_000L)
    clock.mark(1_000L, 11_500L)
    clock.mark(2_000L, 13_000L)
    // 2 s of silence left out at 1.5x: 2015 ms of the part in 10 ms of stream.
    clock.mark(2_010L, 15_015L)
    clock.mark(3_000L, 16_500L)
    assertEquals(0L, clock.skippedMs(500L, 1.5f))
    assertEquals(0L, clock.skippedMs(1_999L, 1.5f))
    assertEquals(2_000L, clock.skippedMs(2_010L, 1.5f))
    // Past the last mark nothing more is guessed.
    assertEquals(2_000L, clock.skippedMs(9_000L, 1.5f))
    assertEquals(0L, RenderClock(0L).skippedMs(5_000L, 1f))
  }

  @Test
  fun aJoiningSpeakerStartsAtTheLeadersPlace() {
    // 1.5x, last heard 400 ms ago at 60 s into the part, aiming 2 s ahead.
    assertEquals(63_600L, LiveJoin.placeMs(60_000L, 1_000L, 1_400L, 1.5f, playing = true, leadMs = 2_000L))
    assertEquals(60_000L, LiveJoin.placeMs(60_000L, 1_000L, 1_400L, 1.5f, playing = false, leadMs = 2_000L))
    assertEquals(null, LiveJoin.secondLead(900L))
    assertEquals(2_500L, LiveJoin.secondLead(2_500L))
  }
}
