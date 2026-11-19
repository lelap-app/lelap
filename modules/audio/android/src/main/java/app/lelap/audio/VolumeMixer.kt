package app.lelap.audio

/**
 * Combines the duck level, the sleep timer fade and the bedtime routine's quieter volume (M86) into
 * the single volume the player gets. A cast receiver gets the fade and the bedtime volume, not the
 * duck: the phone's calls don't play on it (M125).
 */
class VolumeMixer(
  private val applyReceiver: (Float) -> Unit = {},
  private val apply: (Float) -> Unit,
) {
  var duck: Float = 1f
    set(value) {
      field = value.coerceIn(0f, 1f)
      push()
    }

  var fade: Float = 1f
    set(value) {
      field = value.coerceIn(0f, 1f)
      push()
    }

  var bedtime: Float = 1f
    set(value) {
      field = value.coerceIn(0f, 1f)
      push()
    }

  /** What a cast receiver's own volume is scaled by. */
  val receiverLevel: Float
    get() = fade * bedtime

  fun reset() {
    duck = 1f
    fade = 1f
    bedtime = 1f
  }

  private fun push() {
    apply(duck * fade * bedtime)
    applyReceiver(receiverLevel)
  }
}
