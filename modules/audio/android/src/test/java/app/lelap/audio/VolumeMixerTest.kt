package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class VolumeMixerTest {
  private val applied = mutableListOf<Float>()
  private val mixer = VolumeMixer { applied += it }

  @Test fun duckAndFadeMultiply() {
    mixer.duck = 0.2f
    mixer.fade = 0.5f
    assertEquals(0.1f, applied.last(), 1e-6f)
  }

  @Test fun endingDuckKeepsFade() {
    mixer.duck = 0.2f
    mixer.fade = 0.5f
    mixer.duck = 1f
    assertEquals(0.5f, applied.last(), 1e-6f)
  }

  @Test fun valuesAreClamped() {
    mixer.fade = 2f
    assertEquals(1f, applied.last(), 1e-6f)
    mixer.duck = -1f
    assertEquals(0f, applied.last(), 1e-6f)
  }

  @Test fun bedtimeVolumeMultipliesWithTheFade() {
    mixer.bedtime = 0.6f
    mixer.fade = 0.5f
    assertEquals(0.3f, applied.last(), 1e-6f)
    mixer.bedtime = 1f
    assertEquals(0.5f, applied.last(), 1e-6f)
  }

  @Test fun resetRestoresFullVolume() {
    mixer.duck = 0.2f
    mixer.fade = 0.3f
    mixer.bedtime = 0.5f
    mixer.reset()
    assertEquals(1f, applied.last(), 1e-6f)
  }
}
