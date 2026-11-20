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
}
