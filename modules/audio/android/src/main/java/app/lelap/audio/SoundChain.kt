package app.lelap.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** One biquad section (RBJ cookbook), transposed direct form II, with state per channel. */
class Biquad private constructor(
  private val b0: Double,
  private val b1: Double,
  private val b2: Double,
  private val a1: Double,
  private val a2: Double,
) {
  private var z1 = DoubleArray(0)
  private var z2 = DoubleArray(0)

  fun setChannels(count: Int) {
    z1 = DoubleArray(count)
    z2 = DoubleArray(count)
  }

  fun reset() {
    z1.fill(0.0)
    z2.fill(0.0)
  }

  fun process(x: Float, channel: Int): Float {
    val y = b0 * x + z1[channel]
    z1[channel] = b1 * x - a1 * y + z2[channel]
    z2[channel] = b2 * x - a2 * y
    return y.toFloat()
  }

  companion object {
    fun highPass(sampleRate: Int, frequency: Double, q: Double = 1 / sqrt(2.0)): Biquad {
      val w = 2 * PI * frequency / sampleRate
      val alpha = sin(w) / (2 * q)
      val c = cos(w)
      val a0 = 1 + alpha
      return Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - alpha) / a0)
    }

    fun peaking(sampleRate: Int, frequency: Double, gainDb: Double, q: Double): Biquad {
      val a = 10.0.pow(gainDb / 40)
      val w = 2 * PI * frequency / sampleRate
      val alpha = sin(w) / (2 * q)
      val c = cos(w)
      val a0 = 1 + alpha / a
      return Biquad(
        (1 + alpha * a) / a0,
        -2 * c / a0,
        (1 - alpha * a) / a0,
        -2 * c / a0,
        (1 - alpha / a) / a0,
      )
    }
  }
}

/**
 * Peak limiter with instant attack and a slow release. The envelope is never below the frame's
 * peak, so the output never exceeds [ceiling]; the slow release keeps it from pumping on speech.
 */
class SoftLimiter(sampleRate: Int, private val ceiling: Float = CEILING, releaseMs: Double = 150.0) {
  private val release = exp(-1.0 / (sampleRate * releaseMs / 1000)).toFloat()
  private var envelope = 0f

  fun reset() {
    envelope = 0f
  }

  /** Limits one interleaved frame in place, all channels by the same gain so the image holds. */
  fun processFrame(samples: FloatArray, offset: Int, channels: Int) {
    var peak = 0f
    for (c in 0 until channels) peak = max(peak, abs(samples[offset + c]))
    envelope = max(peak, envelope * release)
    if (envelope <= ceiling) return
    val gain = ceiling / envelope
    for (c in 0 until channels) samples[offset + c] *= gain
  }

  companion object {
    /** About -0.1 dBFS: headroom for the conversion back to 16-bit. */
    const val CEILING = 0.989f
  }
}

/**
 * Mono, voice EQ and volume boost on interleaved float samples, in that order. Each can be
 * switched while playing: its share ramps over [RAMP_MS] so nothing clicks, and the filters keep
 * running underneath so they are warm when switched in. With all three off it does nothing.
 */
class SoundChain {
  @Volatile var mono = false
  @Volatile var voiceEq = false
  @Volatile var boost = false

  private var channels = 0
  private var step = 0f
  private var monoMix = 0f
  private var eqMix = 0f
  private var boostMix = 0f
  private var highPass: Biquad? = null
  private var presence: Biquad? = null
  private var limiter: SoftLimiter? = null

  fun configure(sampleRate: Int, channelCount: Int) {
    channels = channelCount
    step = (1000.0 / (sampleRate * RAMP_MS)).toFloat()
    highPass = Biquad.highPass(sampleRate, HIGH_PASS_HZ).apply { setChannels(channelCount) }
    presence = Biquad.peaking(sampleRate, PRESENCE_HZ, PRESENCE_DB, PRESENCE_Q).apply { setChannels(channelCount) }
    limiter = SoftLimiter(sampleRate)
    // A new stream starts with the settings as they are, without a ramp.
    monoMix = if (mono) 1f else 0f
    eqMix = if (voiceEq) 1f else 0f
    boostMix = if (boost) 1f else 0f
  }

  fun reset() {
    highPass?.reset()
    presence?.reset()
    limiter?.reset()
  }

  /** True while any effect is on or still ramping out. */
  val isActive: Boolean
    get() = mono || voiceEq || boost || monoMix > 0f || eqMix > 0f || boostMix > 0f

  fun process(samples: FloatArray, frames: Int) {
    val highPass = highPass ?: return
    val presence = presence ?: return
    val limiter = limiter ?: return
    if (!isActive) {
      reset()
      return
    }
    val monoTarget = if (mono) 1f else 0f
    val eqTarget = if (voiceEq) 1f else 0f
    val boostTarget = if (boost) 1f else 0f
    for (frame in 0 until frames) {
      monoMix = approach(monoMix, monoTarget)
      eqMix = approach(eqMix, eqTarget)
      boostMix = approach(boostMix, boostTarget)
      val offset = frame * channels

      if (monoMix > 0f && channels > 1) {
        var sum = 0f
        for (c in 0 until channels) sum += samples[offset + c]
        val mean = sum / channels
        for (c in 0 until channels) {
          val x = samples[offset + c]
          samples[offset + c] = x + monoMix * (mean - x)
        }
      }

      for (c in 0 until channels) {
        val x = samples[offset + c]
        val wet = presence.process(highPass.process(x, c), c)
        samples[offset + c] = x + eqMix * (wet - x)
      }

      val gain = 1f + boostMix * (BOOST_GAIN - 1f)
      if (gain != 1f) for (c in 0 until channels) samples[offset + c] *= gain
      limiter.processFrame(samples, offset, channels)
    }
  }

  private fun approach(value: Float, target: Float): Float =
    if (value < target) minOf(target, value + step) else if (value > target) maxOf(target, value - step) else value

  companion object {
    const val RAMP_MS = 50.0
    /** Rumble and handling noise below speech. */
    const val HIGH_PASS_HZ = 80.0
    /** Consonants, where speech intelligibility lives. */
    const val PRESENCE_HZ = 3000.0
    const val PRESENCE_DB = 4.0
    const val PRESENCE_Q = 0.9
    /** +6 dB; the limiter catches the peaks. */
    const val BOOST_GAIN = 2f
  }
}
