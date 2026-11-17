package app.lelap.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SoundChainTest {
  private val rate = 48_000

  private fun sine(frequency: Double, frames: Int, amplitude: Float = 0.5f): FloatArray =
    FloatArray(frames) { (amplitude * sin(2 * PI * frequency * it / rate)).toFloat() }

  private fun rms(samples: FloatArray, from: Int): Double {
    var sum = 0.0
    for (i in from until samples.size) sum += samples[i].toDouble() * samples[i]
    return sqrt(sum / (samples.size - from))
  }

  /** Gain in dB of [filter] at [frequency], measured on a sine once the filter has settled. */
  private fun responseDb(filter: Biquad, frequency: Double): Double {
    filter.setChannels(1)
    val input = sine(frequency, rate)
    val output = FloatArray(input.size) { filter.process(input[it], 0) }
    val settle = rate / 2
    return 20 * log10(rms(output, settle) / rms(input, settle))
  }

  @Test fun highPassCutsRumbleAndKeepsSpeech() {
    assertTrue(responseDb(Biquad.highPass(rate, 80.0), 20.0) < -20)
    assertEquals(-3.0, responseDb(Biquad.highPass(rate, 80.0), 80.0), 0.3)
    assertEquals(0.0, responseDb(Biquad.highPass(rate, 80.0), 1000.0), 0.1)
  }

  @Test fun presenceLiftsConsonantsOnly() {
    assertEquals(4.0, responseDb(Biquad.peaking(rate, 3000.0, 4.0, 0.9), 3000.0), 0.1)
    assertEquals(0.0, responseDb(Biquad.peaking(rate, 3000.0, 4.0, 0.9), 200.0), 0.2)
    assertEquals(0.0, responseDb(Biquad.peaking(rate, 3000.0, 4.0, 0.9), 20_000.0), 0.5)
  }

  @Test fun monoAveragesChannels() {
    val chain = SoundChain().apply { mono = true }
    chain.configure(rate, 2)
    val samples = floatArrayOf(0.4f, 0f, -0.2f, 0.2f, 0f, 0.6f)
    chain.process(samples, 3)
    assertArrayEquals(floatArrayOf(0.2f, 0.2f, 0f, 0f, 0.3f, 0.3f), samples, 1e-6f)
  }

  @Test fun allOffLeavesSamplesAlone() {
    val chain = SoundChain()
    chain.configure(rate, 2)
    val samples = floatArrayOf(0.999f, -1f, 0.3f, 0.1f)
    chain.process(samples, 2)
    assertArrayEquals(floatArrayOf(0.999f, -1f, 0.3f, 0.1f), samples, 0f)
  }

  @Test fun boostNeverExceedsFullScale() {
    val chain = SoundChain().apply {
      boost = true
      voiceEq = true
    }
    chain.configure(rate, 2)
    // Full-scale square-ish speech peaks with a hot 3 kHz component, the EQ's boost.
    val frames = rate
    val samples = FloatArray(frames * 2) {
      val t = (it / 2).toDouble() / rate
      (0.7 * sin(2 * PI * 3000 * t) + 0.3 * sin(2 * PI * 150 * t)).toFloat()
    }
    chain.process(samples, frames)
    val peak = samples.maxOf { abs(it) }
    assertTrue("peak $peak", peak <= SoftLimiter.CEILING + 1e-6f)
  }

  @Test fun boostRaisesQuietSpeech() {
    val chain = SoundChain().apply { boost = true }
    chain.configure(rate, 1)
    val input = sine(440.0, rate, amplitude = 0.1f)
    val samples = input.copyOf()
    chain.process(samples, samples.size)
    assertEquals(20 * log10(SoundChain.BOOST_GAIN.toDouble()), 20 * log10(rms(samples, 0) / rms(input, 0)), 0.1)
  }

  @Test fun limiterHoldsAnImpulse() {
    val limiter = SoftLimiter(rate)
    val frame = floatArrayOf(3f, -2f)
    limiter.processFrame(frame, 0, 2)
    assertEquals(SoftLimiter.CEILING, frame[0], 1e-6f)
    // Both channels by the same gain.
    assertEquals(-2f * SoftLimiter.CEILING / 3f, frame[1], 1e-6f)
  }

  @Test fun switchingRampsInsteadOfJumping() {
    val chain = SoundChain()
    chain.configure(rate, 1)
    chain.boost = true
    val samples = FloatArray(rate) { 0.25f }
    chain.process(samples, samples.size)
    // The first sample has barely moved; after the ramp it is fully boosted.
    assertTrue(samples[0] < 0.26f)
    assertEquals(0.5f, samples[rate - 1], 1e-4f)
    for (i in 1 until samples.size) assertTrue(samples[i] - samples[i - 1] < 0.001f)
  }
}
