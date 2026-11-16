package app.lelap.audio

const val SLEEP_TIMER_FADE_MS = 60_000L

/** Volume for the sleep timer's fade: full until the last [fadeMs], then linear down to silence. */
fun fadeVolume(remainingMs: Long, fadeMs: Long = SLEEP_TIMER_FADE_MS): Float = when {
  remainingMs >= fadeMs -> 1f
  remainingMs <= 0 -> 0f
  else -> remainingMs.toFloat() / fadeMs
}

/**
 * Counts down while playing and freezes while the user has paused. The owner calls [tick]
 * regularly while [isRunning].
 */
class SleepTimer(
  private val clock: () -> Long,
  private val onVolume: (Float) -> Unit,
  private val onFinished: () -> Unit,
) {
  /** Set while counting down. */
  var endsAtMs: Long? = null
    private set

  // Time left while frozen.
  private var frozenMs: Long? = null

  val isRunning: Boolean
    get() = endsAtMs != null

  val isActive: Boolean
    get() = endsAtMs != null || frozenMs != null

  val remainingMs: Long?
    get() = endsAtMs?.let { it - clock() } ?: frozenMs

  fun start(durationMs: Long) {
    frozenMs = null
    endsAtMs = clock() + durationMs
    tick()
  }

  fun cancel() {
    if (!isActive) return
    endsAtMs = null
    frozenMs = null
    onVolume(1f)
  }

  fun freeze() {
    val remaining = remainingMs ?: return
    if (!isRunning) return
    endsAtMs = null
    frozenMs = remaining.coerceAtLeast(0L)
  }

  fun resume() {
    val remaining = frozenMs ?: return
    frozenMs = null
    endsAtMs = clock() + remaining
    tick()
  }

  fun tick() {
    if (!isRunning) return
    val remaining = remainingMs ?: return
    if (remaining <= 0) {
      endsAtMs = null
      onFinished()
      // Restore after pausing so the next play is at normal volume.
      onVolume(1f)
    } else {
      onVolume(fadeVolume(remaining))
    }
  }
}
