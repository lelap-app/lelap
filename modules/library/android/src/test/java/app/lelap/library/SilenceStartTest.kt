package app.lelap.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** M85: the scan starts at once, checks the battery itself and says how far it is. */
class SilenceStartTest {
  private val job = SilenceJob(
    "book-1",
    listOf("content://a/1.mp3", "content://a/2.mp3"),
    -45.0,
    2_500L,
    title = "Dune",
    durationsMs = listOf(60_000L, 180_000L),
  )

  @Test fun `keeps the title and lengths`() {
    assertEquals(job, SilenceJob.decode(job.encode()))
    assertNull(SilenceJob.decode(job.copy(title = "  ").encode())?.title)
    assertEquals(200, SilenceJob.decode(job.copy(title = "x".repeat(500)).encode())?.title?.length)
  }

  @Test fun `goes by the stored lengths`() {
    assertEquals(0.0, job.fractionDone(SilenceProgress()), 0.0)
    assertEquals(0.125, job.fractionDone(SilenceProgress(positionMs = 30_000L)), 1e-9)
    val firstDone = SilenceProgress(done = listOf(emptyList()), durations = listOf(60_000L), positionMs = 90_000L)
    assertEquals(0.625, job.fractionDone(firstDone), 1e-9)
  }

  @Test fun `goes by whole files when a length is unknown, and stays between 0 and 1`() {
    val unknown = job.copy(durationsMs = listOf(60_000L, 0L))
    val firstDone = SilenceProgress(done = listOf(emptyList()), durations = listOf(60_000L), positionMs = 90_000L)
    assertEquals(0.5, unknown.fractionDone(firstDone), 1e-9)
    assertEquals(0.5, job.copy(durationsMs = emptyList()).fractionDone(firstDone), 1e-9)
    assertEquals(1.0, job.fractionDone(SilenceProgress(positionMs = 999_000L)), 0.0)
  }

  @Test fun `the battery is low only when not charging`() {
    assertTrue(Battery.isLow(percent = 10, charging = false, systemLow = null))
    assertTrue(Battery.isLow(percent = 15, charging = false, systemLow = null))
    assertFalse(Battery.isLow(percent = 84, charging = false, systemLow = null))
    assertFalse(Battery.isLow(percent = 5, charging = true, systemLow = true))
    // The system's own word wins over the level.
    assertFalse(Battery.isLow(percent = 14, charging = false, systemLow = false))
    assertTrue(Battery.isLow(percent = 18, charging = false, systemLow = true))
    assertFalse(Battery.isLow(percent = null, charging = false, systemLow = null))
  }
}
