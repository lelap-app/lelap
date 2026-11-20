package app.lelap.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.log10
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

private fun dbToGain(db: Float): Float = 10f.pow(db / 20f)

private fun gainToDb(gain: Float): Float = 20f * log10(max(gain, 1e-6f))

/**
 * Gentle feed-forward compressor for speech (M84's voice boost): words under [thresholdDb] come
 * up by [makeupDb], louder ones are held back, so a soft voice and a loud one end up closer.
 */
class Compressor(
  sampleRate: Int,
  private val thresholdDb: Float = THRESHOLD_DB,
  private val ratio: Float = RATIO,
  private val makeupDb: Float = MAKEUP_DB,
  attackMs: Double = 5.0,
  releaseMs: Double = 150.0,
) {
  private val attack = exp(-1.0 / (sampleRate * attackMs / 1000)).toFloat()
  private val release = exp(-1.0 / (sampleRate * releaseMs / 1000)).toFloat()
  private var envelope = 0f

  fun reset() {
    envelope = 0f
  }

  /** The gain for one frame whose loudest channel reaches [peak]. */
  fun gainFor(peak: Float): Float {
    val coefficient = if (peak > envelope) attack else release
    envelope = peak + coefficient * (envelope - peak)
    val over = gainToDb(envelope) - thresholdDb
    val reduction = if (over > 0f) over * (1f - 1f / ratio) else 0f
    return dbToGain(makeupDb - reduction)
  }

  companion object {
    const val THRESHOLD_DB = -24f
    const val RATIO = 3f
    const val MAKEUP_DB = 6f
  }
}

/**
 * Even loudness (M84): a fixed gain from the file's ReplayGain tags when it has them, otherwise
 * a light measured one. The measurement averages the level of 400 ms blocks that hold sound
 * (silence is left out), and the gain glides towards [TARGET_DB] over seconds, so it evens out
 * books and episodes without pumping within a sentence.
 */
class Leveller(val sampleRate: Int) {
  private val blockFrames = (sampleRate * BLOCK_MS / 1000).coerceAtLeast(1)
  private val glide = (1 - exp(-1.0 / (sampleRate * GLIDE_S))).toFloat()
  private var sum = 0.0
  private var count = 0
  private var blocks = 0
  private var loudnessDb = Float.NaN
  private var gain = 1f

  /** From the file's tags; NaN measures instead. */
  var tagGainDb = Float.NaN

  /** The gain it glides towards now, in dB. */
  val targetDb: Float
    get() = when {
      !tagGainDb.isNaN() -> tagGainDb.coerceIn(-MAX_CUT_DB, MAX_LIFT_DB)
      loudnessDb.isNaN() -> 0f
      else -> (TARGET_DB - loudnessDb).coerceIn(-MAX_CUT_DB, MAX_LIFT_DB)
    }

  val gainDb: Float
    get() = gainToDb(gain)

  /** A new book or episode is measured from scratch. */
  fun forget() {
    sum = 0.0
    count = 0
    blocks = 0
    loudnessDb = Float.NaN
  }

  /** Feeds one frame's mean square and returns the gain for it. */
  fun gainFor(meanSquare: Float): Float {
    sum += meanSquare
    if (++count >= blockFrames) {
      val blockDb = 10f * log10(max((sum / count).toFloat(), 1e-12f))
      sum = 0.0
      count = 0
      if (blockDb > GATE_DB) {
        blocks++
        // A plain mean over the first blocks settles fast; then a moving one of about 10 s.
        val weight = max(1f / blocks, 1f / AVERAGE_BLOCKS)
        loudnessDb = if (loudnessDb.isNaN()) blockDb else loudnessDb + (blockDb - loudnessDb) * weight
      }
    }
    val target = dbToGain(targetDb)
    gain += (target - gain) * glide
    return gain
  }

  companion object {
    const val BLOCK_MS = 400
    /** About -18 LUFS for speech, the level ReplayGain 2 aims at too. */
    const val TARGET_DB = -20f
    /** Quieter blocks are pauses and room noise, which must not pull the gain up. */
    const val GATE_DB = -50f
    const val AVERAGE_BLOCKS = 25f
    const val MAX_LIFT_DB = 10f
    const val MAX_CUT_DB = 10f
    const val GLIDE_S = 1.5
  }
}

/**
 * Mono, voice boost, even loudness and volume boost on interleaved float samples, in that order,
 * with a peak limiter last. Each can be switched while playing: its share ramps over [RAMP_MS] so
 * nothing clicks, and the filters keep running underneath so they are warm when switched in.
 * With all off it does nothing.
 */
class SoundChain {
  @Volatile var mono = false
  /** Voice boost: the voice EQ of M22 and a gentle [Compressor] (M84). */
  @Volatile var voiceEq = false
  @Volatile var evenLoudness = false
  @Volatile var boost = false

  /** ReplayGain of the file playing, in dB; NaN when it has none, so the level is measured. */
  @Volatile var replayGainDb = Float.NaN

  @Volatile private var forgetLoudness = false

  private var channels = 0
  private var step = 0f
  private var monoMix = 0f
  private var eqMix = 0f
  private var loudMix = 0f
  private var boostMix = 0f
  private var highPass: Biquad? = null
  private var presence: Biquad? = null
  private var compressor: Compressor? = null
  private var leveller: Leveller? = null
  private var limiter: SoftLimiter? = null
  private var dry = FloatArray(0)
  private var wet = FloatArray(0)

  /** The even-loudness gain now, in dB, for diagnostics and tests. */
  val loudnessGainDb: Float
    get() = leveller?.gainDb ?: 0f

  fun configure(sampleRate: Int, channelCount: Int) {
    channels = channelCount
    step = (1000.0 / (sampleRate * RAMP_MS)).toFloat()
    highPass = Biquad.highPass(sampleRate, HIGH_PASS_HZ).apply { setChannels(channelCount) }
    presence = Biquad.peaking(sampleRate, PRESENCE_HZ, PRESENCE_DB, PRESENCE_Q).apply { setChannels(channelCount) }
    compressor = Compressor(sampleRate)
    // A new format keeps what was measured: it is usually the next part of the same book.
    val measured = leveller
    leveller = if (measured != null && measured.sampleRate == sampleRate) measured else Leveller(sampleRate)
    limiter = SoftLimiter(sampleRate)
    dry = FloatArray(channelCount)
    wet = FloatArray(channelCount)
    // A new stream starts with the settings as they are, without a ramp.
    monoMix = if (mono) 1f else 0f
    eqMix = if (voiceEq) 1f else 0f
    loudMix = if (evenLoudness) 1f else 0f
    boostMix = if (boost) 1f else 0f
  }

  /** Takes [other]'s switches, so a part rendered for a cast receiver follows the listener's (M134). */
  fun follow(other: SoundChain) {
    mono = other.mono
    voiceEq = other.voiceEq
    evenLoudness = other.evenLoudness
    boost = other.boost
  }

  /** The next book or episode is measured afresh. */
  fun restartLoudness() {
    forgetLoudness = true
  }

  fun reset() {
    highPass?.reset()
    presence?.reset()
    compressor?.reset()
    limiter?.reset()
  }

  /** True while any effect is on or still ramping out. */
  val isActive: Boolean
    get() = mono || voiceEq || evenLoudness || boost ||
      monoMix > 0f || eqMix > 0f || loudMix > 0f || boostMix > 0f

  fun process(samples: FloatArray, frames: Int) {
    val highPass = highPass ?: return
    val presence = presence ?: return
    val compressor = compressor ?: return
    val leveller = leveller ?: return
    val limiter = limiter ?: return
    if (forgetLoudness) {
      forgetLoudness = false
      leveller.forget()
    }
    leveller.tagGainDb = replayGainDb
    if (!isActive) {
      reset()
      return
    }
    val monoTarget = if (mono) 1f else 0f
    val eqTarget = if (voiceEq) 1f else 0f
    val loudTarget = if (evenLoudness) 1f else 0f
    val boostTarget = if (boost) 1f else 0f
    for (frame in 0 until frames) {
      monoMix = approach(monoMix, monoTarget)
      eqMix = approach(eqMix, eqTarget)
      loudMix = approach(loudMix, loudTarget)
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

      var peak = 0f
      for (c in 0 until channels) {
        dry[c] = samples[offset + c]
        wet[c] = presence.process(highPass.process(dry[c], c), c)
        peak = max(peak, abs(wet[c]))
      }
      // The compressor's share ramps with the EQ's; it only listens while voice boost is on.
      val squeeze = if (eqMix > 0f) compressor.gainFor(peak) else 1f
      var meanSquare = 0f
      for (c in 0 until channels) {
        val x = dry[c] + eqMix * (wet[c] * squeeze - dry[c])
        samples[offset + c] = x
        meanSquare += x * x
      }

      val level = if (loudMix > 0f) leveller.gainFor(meanSquare / channels) else 1f
      val gain = (1f + loudMix * (level - 1f)) * (1f + boostMix * (BOOST_GAIN - 1f))
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
