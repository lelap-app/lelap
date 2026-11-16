package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class VolumeMixerTest {
  private val applied = mutableListOf<Float>()
  private val mixer = VolumeMixer { applied += it }

  @Test fun duckAndLullMultiply() {
    mixer.duck = 0.2f
    mixer.lull = 0.5f
    assertEquals(0.1f, applied.last(), 1e-6f)
  }

  @Test fun endingDuckKeepsLull() {
    mixer.duck = 0.2f
    mixer.lull = 0.5f
    mixer.duck = 1f
    assertEquals(0.5f, applied.last(), 1e-6f)
  }

  @Test fun valuesAreClamped() {
    mixer.lull = 2f
    assertEquals(1f, applied.last(), 1e-6f)
    mixer.duck = -1f
    assertEquals(0f, applied.last(), 1e-6f)
  }

  @Test fun resetRestoresFullVolume() {
    mixer.duck = 0.2f
    mixer.lull = 0.3f
    mixer.reset()
    assertEquals(1f, applied.last(), 1e-6f)
  }
}
