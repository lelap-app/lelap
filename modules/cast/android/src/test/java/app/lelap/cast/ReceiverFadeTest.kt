package app.lelap.cast

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceiverFadeTest {
  private val fade = ReceiverFade(step = 0.03f, minGapMs = 1_000L)

  @Test
  fun noFadeSendsNothing() {
    assertNull(fade.update(1f, 0.5f, 0L))
    assertFalse(fade.isFading)
  }

  @Test
  fun fadesFromTheReceiversOwnVolume() {
    assertEquals(0.45f, fade.update(0.9f, 0.5f, 0L)!!, 0.001f)
    assertTrue(fade.isFading)
    // The receiver now reports the lowered volume; the fade keeps measuring from 0.5.
    assertEquals(0.25f, fade.update(0.5f, 0.45f, 2_000L)!!, 0.001f)
  }

  @Test
  fun stepsAreRateLimitedAndSmallOnesSkipped() {
    fade.update(0.9f, 0.5f, 0L)
    assertNull(fade.update(0.5f, 0.45f, 500L))
    assertNull(fade.update(0.88f, 0.45f, 2_000L))
  }

  @Test
  fun silenceAlwaysGoesOut() {
    fade.update(0.9f, 0.5f, 0L)
    assertEquals(0f, fade.update(0f, 0.45f, 100L)!!, 0f)
    assertNull(fade.update(0f, 0f, 3_000L))
  }

  @Test
  fun theVolumeComesBackOnceAfterTheTimer() {
    fade.update(0.5f, 0.6f, 0L)
    fade.update(0f, 0.3f, 60_000L)
    assertEquals(0.6f, fade.update(1f, 0f, 60_100L)!!, 0f)
    assertNull(fade.update(1f, 0.6f, 61_000L))
    assertFalse(fade.isFading)
  }

  @Test
  fun aReceiverThatDoesNotSayItsVolumeIsNotFaded() {
    assertNull(fade.update(0.5f, null, 0L))
    assertNull(fade.update(1f, null, 1_000L))
  }
}
