package app.lelap.library

import kotlin.math.log10
import kotlin.math.sqrt

/** A stretch of a file quieter than the threshold, in milliseconds from the file's start. */
data class Silence(val startMs: Long, val endMs: Long)

/**
 * Finds silences in decoded audio, one 50 ms window at a time, so a ten-hour book never sits in
 * memory. The thresholds come from `SILENCE_RULES` in `@lelap/core`, which also turns the
 * silences into chapters.
 */
class SilenceScanner(
  private val sampleRate: Int,
  private val channels: Int,
  private val thresholdDb: Double,
  private val minSilenceMs: Long,
  /** Where in the file the first sample fed in lies, for a scan resumed part way. */
  startMs: Long = 0L,
) {
  private val windowFrames = (sampleRate * WINDOW_MS / 1000).coerceAtLeast(1)
  private val startFrame = startMs * sampleRate / 1000
  private var frames = 0L
  private var windowFill = 0
  private var windowSum = 0.0
  private var channelIndex = 0
  private var frameSum = 0.0
  private var quietSinceMs: Long? = null
  private val found = mutableListOf<Silence>()

  val silences: List<Silence> get() = found

  /** The place up to which the scan is final: before a silence still open, or the place now. */
  val settledMs: Long get() = quietSinceMs ?: nowMs()

  /** How far the scan has read into the file. */
  fun nowMs() = (startFrame + frames) * 1000 / sampleRate

  /** Interleaved 16-bit samples. */
  fun feed(samples: ShortArray, count: Int = samples.size) {
    for (i in 0 until count) add(samples[i] / 32768.0)
  }

  /** Interleaved float samples in -1..1. */
  fun feed(samples: FloatArray, count: Int = samples.size) {
    for (i in 0 until count) add(samples[i].toDouble())
  }

  /** Closes a silence that runs to the end of the file. */
  fun finish(): List<Silence> {
    close(nowMs())
    return found
  }

  private fun add(sample: Double) {
    frameSum += sample * sample
    if (++channelIndex < channels) return
    windowSum += frameSum / channels
    channelIndex = 0
    frameSum = 0.0
    frames++
    if (++windowFill < windowFrames) return
    val rms = sqrt(windowSum / windowFill)
    val db = if (rms <= 0.0) -120.0 else 20 * log10(rms)
    val endMs = nowMs()
    val startMs = endMs - WINDOW_MS
    if (db < thresholdDb) {
      if (quietSinceMs == null) quietSinceMs = startMs.coerceAtLeast(0L)
    } else {
      close(startMs)
    }
    windowFill = 0
    windowSum = 0.0
  }

  private fun close(endMs: Long) {
    val since = quietSinceMs ?: return
    quietSinceMs = null
    if (endMs - since >= minSilenceMs) found += Silence(since, endMs)
  }

  companion object {
    const val WINDOW_MS = 50L
  }
}
