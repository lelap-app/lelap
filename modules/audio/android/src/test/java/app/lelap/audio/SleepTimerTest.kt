package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SleepTimerTest {
  private var now = 0L
  private val volumes = mutableListOf<Float>()
  private var finished = 0
  private val sleepTimer = SleepTimer(clock = { now }, onVolume = { volumes += it }, onFinished = { finished++ })

  @Test fun fadeCurve() {
    assertEquals(1f, fadeVolume(120_000), 1e-6f)
    assertEquals(1f, fadeVolume(60_000), 1e-6f)
    assertEquals(0.5f, fadeVolume(30_000), 1e-6f)
    assertEquals(0f, fadeVolume(0), 1e-6f)
    assertEquals(0f, fadeVolume(-5), 1e-6f)
  }

  @Test fun fadesOverTheLastMinuteThenFinishes() {
    sleepTimer.start(120_000)
    now = 30_000; sleepTimer.tick()
    assertEquals(1f, volumes.last(), 1e-6f)
    now = 90_000; sleepTimer.tick()
    assertEquals(0.5f, volumes.last(), 1e-6f)
    assertEquals(0, finished)
    now = 120_000; sleepTimer.tick()
    assertEquals(1, finished)
    assertEquals(1f, volumes.last(), 1e-6f)
    assertNull(sleepTimer.remainingMs)
    assertFalse(sleepTimer.isActive)
    now = 130_000; sleepTimer.tick()
    assertEquals(1, finished)
  }

  @Test fun cancelRestoresVolume() {
    sleepTimer.start(120_000)
    now = 100_000; sleepTimer.tick()
    sleepTimer.cancel()
    assertEquals(1f, volumes.last(), 1e-6f)
    assertNull(sleepTimer.remainingMs)
    assertEquals(0, finished)
  }

  @Test fun startWhileActiveRestarts() {
    sleepTimer.start(60_000)
    now = 50_000
    sleepTimer.start(120_000)
    assertEquals(120_000L, sleepTimer.remainingMs)
    assertEquals(170_000L, sleepTimer.endsAtMs)
  }

  @Test fun freezeStopsTheCountdownUntilResume() {
    sleepTimer.start(120_000)
    now = 30_000
    sleepTimer.freeze()
    assertTrue(sleepTimer.isActive)
    assertFalse(sleepTimer.isRunning)
    now = 1_000_000; sleepTimer.tick()
    assertEquals(90_000L, sleepTimer.remainingMs)
    assertEquals(0, finished)
    sleepTimer.resume()
    assertTrue(sleepTimer.isRunning)
    assertEquals(1_090_000L, sleepTimer.endsAtMs)
  }

  @Test fun freezeDuringTheFadeKeepsItsLevelAndContinues() {
    sleepTimer.start(60_000)
    now = 30_000; sleepTimer.tick()
    sleepTimer.freeze()
    now = 200_000
    sleepTimer.resume()
    assertEquals(0.5f, volumes.last(), 1e-6f)
    now = 230_000; sleepTimer.tick()
    assertEquals(1, finished)
  }

  @Test fun cancelWhileFrozenClearsIt() {
    sleepTimer.start(60_000)
    sleepTimer.freeze()
    sleepTimer.cancel()
    assertFalse(sleepTimer.isActive)
    assertEquals(1f, volumes.last(), 1e-6f)
  }

  @Test fun freezeAndResumeWithoutATimerDoNothing() {
    sleepTimer.freeze()
    sleepTimer.resume()
    assertFalse(sleepTimer.isActive)
    assertTrue(volumes.isEmpty())
  }
}
