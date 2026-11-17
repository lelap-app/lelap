package app.lelap.audio

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShakeDetectorTest {
  private var now = 0L
  private val detector = ShakeDetector { now }
  private val hard = 2.5f * ShakeDetector.GRAVITY

  private fun jolt(at: Long): Boolean {
    now = at
    return detector.onSample(hard, 0f, 0f)
  }

  @Test fun threeJoltsInAWindowAreAShake() {
    assertFalse(jolt(0))
    assertFalse(jolt(200))
    assertTrue(jolt(400))
  }

  @Test fun lyingStillIsNoShake() {
    repeat(100) {
      now = it * 20L
      assertFalse(detector.onSample(0f, 0f, ShakeDetector.GRAVITY))
    }
  }

  @Test fun samplesOfOneJoltCountOnce() {
    assertFalse(jolt(0))
    assertFalse(jolt(20))
    assertFalse(jolt(40))
  }

  @Test fun slowJoltsAreNoShake() {
    assertFalse(jolt(0))
    assertFalse(jolt(500))
    assertFalse(jolt(1_000))
    assertFalse(jolt(1_500))
  }

  @Test fun aLongShakeCountsOnce() {
    jolt(0); jolt(200)
    assertTrue(jolt(400))
    assertFalse(jolt(600))
    assertFalse(jolt(800))
    assertFalse(jolt(1_000))
    assertFalse(jolt(2_500))
    assertFalse(jolt(2_700))
    assertTrue(jolt(2_900))
  }
}
