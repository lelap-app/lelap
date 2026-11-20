package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PreparingAudioTest {
  private val now = 1_700_000_000_000L

  @Test fun `waits as long as Retry-After says on a 503`() {
    assertEquals(30_000L, PreparingAudio.delayMs(503, "30", now, now))
    assertEquals(5_000L, PreparingAudio.delayMs(503, "0", now, now))
  }

  @Test fun `is not preparing without a 503 and a readable Retry-After`() {
    assertNull(PreparingAudio.delayMs(503, null, now, now))
    assertNull(PreparingAudio.delayMs(503, "soon", now, now))
    assertNull(PreparingAudio.delayMs(500, "30", now, now))
    assertNull(PreparingAudio.delayMs(null, "30", now, now))
  }

  @Test fun `stops asking 10 minutes after the first answer`() {
    val late = now + PreparingAudio.WAIT_MS - 30_000L
    assertEquals(30_000L, PreparingAudio.delayMs(503, "30", now, late))
    assertNull(PreparingAudio.delayMs(503, "31", now, late))
    // An hour's wait never fits.
    assertNull(PreparingAudio.delayMs(503, "3600", now, now))
  }

  @Test fun `reads an HTTP date`() {
    // 2023-11-14T22:13:20Z is `now`.
    assertEquals(60L, PreparingAudio.retryAfterSeconds("Tue, 14 Nov 2023 22:14:20 GMT", now))
  }

  @Test fun `other failures keep the usual number of tries`() {
    assertFalse(PreparingAudio.givesUp(3, 3))
    assertTrue(PreparingAudio.givesUp(4, 3))
  }
}
