package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LullTest {
  private var now = 0L
  private val volumes = mutableListOf<Float>()
  private var finished = 0
  private val lull = Lull(clock = { now }, onVolume = { volumes += it }, onFinished = { finished++ })

  @Test fun fadeCurve() {
    assertEquals(1f, lullVolume(120_000), 1e-6f)
    assertEquals(1f, lullVolume(60_000), 1e-6f)
    assertEquals(0.5f, lullVolume(30_000), 1e-6f)
    assertEquals(0f, lullVolume(0), 1e-6f)
    assertEquals(0f, lullVolume(-5), 1e-6f)
  }

  @Test fun fadesOverTheLastMinuteThenFinishes() {
    lull.start(120_000)
    now = 30_000; lull.tick()
    assertEquals(1f, volumes.last(), 1e-6f)
    now = 90_000; lull.tick()
    assertEquals(0.5f, volumes.last(), 1e-6f)
    assertEquals(0, finished)
    now = 120_000; lull.tick()
    assertEquals(1, finished)
    assertEquals(1f, volumes.last(), 1e-6f)
    assertNull(lull.remainingMs)
    assertNull(lull.endsAtMs)
    now = 130_000; lull.tick()
    assertEquals(1, finished)
  }

  @Test fun cancelRestoresVolume() {
    lull.start(120_000)
    now = 100_000; lull.tick()
    lull.cancel()
    assertEquals(1f, volumes.last(), 1e-6f)
    assertNull(lull.remainingMs)
    assertEquals(0, finished)
  }

  @Test fun startWhileActiveRestarts() {
    lull.start(60_000)
    now = 50_000
    lull.start(120_000)
    assertEquals(120_000L, lull.remainingMs)
    assertEquals(170_000L, lull.endsAtMs)
  }
}
