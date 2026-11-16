package app.lelap.audio

const val LULL_FADE_MS = 60_000L

/** Volume for the Lull fade: full until the last [fadeMs], then linear down to silence. */
fun lullVolume(remainingMs: Long, fadeMs: Long = LULL_FADE_MS): Float = when {
  remainingMs >= fadeMs -> 1f
  remainingMs <= 0 -> 0f
  else -> remainingMs.toFloat() / fadeMs
}

/** Sleep timer. The owner calls [tick] regularly while [endsAtMs] is set. */
class Lull(
  private val clock: () -> Long,
  private val onVolume: (Float) -> Unit,
  private val onFinished: () -> Unit,
) {
  var endsAtMs: Long? = null
    private set

  val remainingMs: Long?
    get() = endsAtMs?.let { it - clock() }

  fun start(durationMs: Long) {
    endsAtMs = clock() + durationMs
    tick()
  }

  fun cancel() {
    if (endsAtMs == null) return
    endsAtMs = null
    onVolume(1f)
  }

  fun tick() {
    val remaining = remainingMs ?: return
    if (remaining <= 0) {
      endsAtMs = null
      onFinished()
      // Restore after pausing so the next play is at normal volume.
      onVolume(1f)
    } else {
      onVolume(lullVolume(remaining))
    }
  }
}
