package app.lelap.cast

import kotlin.math.abs

/**
 * The sleep timer's fade on a receiver: its own volume, lowered with the fade and put back after.
 * Each step is a network call, so a new volume goes out only when it moved by [step] and
 * [minGapMs] passed. Receivers that do not say their volume are not faded; the timer still pauses.
 */
class ReceiverFade(private val step: Float = 0.03f, private val minGapMs: Long = 1_000L) {
  // The receiver's volume when the fade began; what the listener had set.
  private var base: Float? = null
  private var sent: Float? = null
  private var sentAt = 0L

  val isFading: Boolean
    get() = base != null

  /**
   * [level] is the timer's fade, 1 for none. Returns the volume to send the receiver now, or null.
   * Back at 1 it returns the volume from before the fade, once.
   */
  fun update(level: Float, receiverVolume: Float?, now: Long): Float? {
    if (level >= 1f) {
      val restore = base ?: return null
      base = null
      sent = null
      return restore
    }
    val from = base ?: (receiverVolume ?: return null).also { base = it }
    val target = (from * level.coerceAtLeast(0f)).coerceIn(0f, 1f)
    val last = sent
    val due = when {
      last == null -> true
      target == last -> false
      // Silence always goes out, so the receiver is quiet when the timer pauses it.
      target == 0f -> true
      else -> abs(target - last) >= step && now - sentAt >= minGapMs
    }
    if (!due) return null
    sent = target
    sentAt = now
    return target
  }
}
