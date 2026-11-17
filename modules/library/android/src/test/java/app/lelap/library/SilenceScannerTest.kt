package app.lelap.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SilenceScannerTest {
  private val rate = 8_000

  /** [ms] of a tone loud enough to count as speech, or of near silence. */
  private fun audio(ms: Int, loud: Boolean, channels: Int = 1): ShortArray {
    val frames = rate * ms / 1000
    return ShortArray(frames * channels) { i ->
      val amplitude = if (loud) 8_000 else 20
      if ((i / channels) % 2 == 0) amplitude.toShort() else (-amplitude).toShort()
    }
  }

  private fun scanner(channels: Int = 1, startMs: Long = 0L) =
    SilenceScanner(rate, channels, thresholdDb = -45.0, minSilenceMs = 2_000L, startMs = startMs)

  @Test fun `finds a long silence between speech`() {
    val s = scanner()
    s.feed(audio(5_000, loud = true))
    s.feed(audio(3_000, loud = false))
    s.feed(audio(5_000, loud = true))
    assertEquals(listOf(Silence(5_000, 8_000)), s.finish())
  }

  @Test fun `ignores pauses shorter than the minimum`() {
    val s = scanner()
    s.feed(audio(5_000, loud = true))
    s.feed(audio(1_500, loud = false))
    s.feed(audio(5_000, loud = true))
    assertEquals(emptyList<Silence>(), s.finish())
  }

  @Test fun `closes a silence at the end of the file and reads stereo`() {
    val s = scanner(channels = 2)
    s.feed(audio(4_000, loud = true, channels = 2))
    s.feed(audio(2_500, loud = false, channels = 2))
    assertEquals(listOf(Silence(4_000, 6_500)), s.finish())
  }

  @Test fun `counts from where a resumed scan starts, and settles before an open silence`() {
    val s = scanner(startMs = 60_000L)
    s.feed(audio(1_000, loud = true))
    assertEquals(61_000L, s.settledMs)
    s.feed(audio(500, loud = false))
    assertEquals(61_000L, s.settledMs)
  }

  @Test fun `reads float samples`() {
    val s = scanner()
    s.feed(FloatArray(rate * 3) { if (it < rate) 0.3f else 0f })
    assertEquals(listOf(Silence(1_000, 3_000)), s.finish())
  }

  @Test fun `jobs and progress round-trip, and refuse remote files and unsafe IDs`() {
    val job = SilenceJob("book-1", listOf("content://a/1.m4b", "file:///data/2.mp3"), -45.0, 2_500L)
    assertEquals(job, SilenceJob.decode(job.encode()))
    assertNull(SilenceJob.decode(job.copy(files = listOf("https://example.org/1.mp3")).encode()))
    assertNull(SilenceJob.decode(job.copy(bookId = "../x").encode()))
    val progress = SilenceProgress(listOf(listOf(Silence(1, 2))), listOf(9L), listOf(Silence(3, 4)), 5)
    assertEquals(progress, SilenceProgress.decode(progress.encode()))
    assertEquals(1, progress.fileIndex)
    assertEquals(SilenceProgress(), SilenceProgress.decode("not json"))
  }
}
