package app.lelap.audio

/** Combines the duck level and the sleep timer fade into the single volume the player gets. */
class VolumeMixer(private val apply: (Float) -> Unit) {
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

  fun reset() {
    duck = 1f
    fade = 1f
  }

  private fun push() = apply(duck * fade)
}
