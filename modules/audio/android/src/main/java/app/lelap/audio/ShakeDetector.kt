package app.lelap.audio

import kotlin.math.sqrt

/**
 * Turns accelerometer samples into shakes: [PEAKS] jolts of more than [THRESHOLD] beyond gravity
 * within [WINDOW_MS]. After a shake it ignores the hand for [DEBOUNCE_MS], so one long shake
 * adds time once.
 */
class ShakeDetector(private val clock: () -> Long) {
  companion object {
    const val GRAVITY = 9.81f
    const val THRESHOLD = 0.6f * GRAVITY
    const val PEAKS = 3
    const val WINDOW_MS = 800L
    const val DEBOUNCE_MS = 2_000L
    // Samples closer than this are one jolt, not two.
    const val PEAK_GAP_MS = 80L
  }

  private val peaks = ArrayDeque<Long>()
  private var lastShakeAt = Long.MIN_VALUE / 2

  /** Returns true when this sample completes a shake. Values in m/s², gravity included. */
  fun onSample(x: Float, y: Float, z: Float): Boolean {
    val now = clock()
    if (now - lastShakeAt < DEBOUNCE_MS) return false
    val jolt = sqrt(x * x + y * y + z * z) - GRAVITY
    if (jolt < THRESHOLD) return false
    if (peaks.isNotEmpty() && now - peaks.last() < PEAK_GAP_MS) return false
    peaks.addLast(now)
    while (peaks.isNotEmpty() && now - peaks.first() > WINDOW_MS) peaks.removeFirst()
    if (peaks.size < PEAKS) return false
    peaks.clear()
    lastShakeAt = now
    return true
  }

  fun reset() = peaks.clear()
}
