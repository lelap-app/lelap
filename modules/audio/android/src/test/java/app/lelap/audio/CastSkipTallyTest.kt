package app.lelap.audio

import app.lelap.cast.RenderClock
import org.junit.Assert.assertEquals
import org.junit.Test

class CastSkipTallyTest {
  private fun clock() = RenderClock(0L).apply {
    mark(1_000L, 1_000L)
    // 3 s of silence left out at 1x.
    mark(1_010L, 4_010L)
    mark(2_000L, 5_000L)
    mark(2_010L, 7_010L)
  }

  @Test fun `counts what the receiver played, once`() {
    val tally = CastSkipTally()
    tally.start(clock(), 1f)
    assertEquals(0L, tally.played(500L))
    assertEquals(3_000L, tally.played(1_500L))
    assertEquals(0L, tally.played(1_600L))
    // Back before the pause: nothing more, and nothing taken back.
    assertEquals(0L, tally.played(800L))
    assertEquals(2_000L, tally.played(2_500L))
  }

  @Test fun `a new stream or a file starts again`() {
    val tally = CastSkipTally()
    tally.start(clock(), 1f)
    tally.played(2_500L)
    tally.start(null, 1f)
    assertEquals(0L, tally.played(2_500L))
    tally.start(clock(), 1f)
    assertEquals(5_000L, tally.played(2_500L))
  }
}
