package app.lelap.audio

const val SLEEP_TIMER_FADE_MS = 60_000L

/** A shake while this little is left adds [SHAKE_EXTENSION_MS]. */
const val SHAKE_WINDOW_MS = 5 * 60_000L
const val SHAKE_EXTENSION_MS = 10 * 60_000L

// The owner stops a chapter or episode timer exactly at its boundary; ticks only step in when
// playback has run this far past it (a missed boundary).
private const val BOUNDARY_OVERRUN_MS = 1_000L

/** Volume for the sleep timer's fade: full until the last [fadeMs], then linear down to silence. */
fun fadeVolume(remainingMs: Long, fadeMs: Long = SLEEP_TIMER_FADE_MS): Float = when {
  remainingMs >= fadeMs -> 1f
  remainingMs <= 0 -> 0f
  else -> remainingMs.toFloat() / fadeMs
}

/**
 * Counts down while playing and freezes while the user has paused. The owner calls [tick]
 * regularly while [isRunning].
 *
 * A [SleepMode.MINUTES] timer counts wall time. A chapter or episode timer asks the owner how much
 * listening is left before the boundary, so it follows seeks and speed changes; the owner calls
 * [finish] when playback reaches the boundary.
 */
class SleepTimer(
  private val clock: () -> Long,
  private val onVolume: (Float) -> Unit,
  private val onFinished: () -> Unit,
) {
  var mode: SleepMode? = null
    private set

  /** Set while a minutes timer counts down. */
  var endsAtMs: Long? = null
    private set

  // Time left while a minutes timer is frozen.
  private var frozenMs: Long? = null

  // A chapter or episode timer: listening time left, and whether it is counting.
  private var untilBoundary: (() -> Long)? = null
  private var boundaryRunning = false

  val isRunning: Boolean
    get() = endsAtMs != null || (untilBoundary != null && boundaryRunning)

  val isActive: Boolean
    get() = endsAtMs != null || frozenMs != null || untilBoundary != null

  val remainingMs: Long?
    get() = untilBoundary?.invoke() ?: endsAtMs?.let { it - clock() } ?: frozenMs

  /** Whether a shake counts now: while counting down, in the fade or the minutes before it. */
  val acceptsShake: Boolean
    get() = isRunning && (remainingMs ?: Long.MAX_VALUE) <= SHAKE_WINDOW_MS

  fun start(durationMs: Long) {
    untilBoundary = null
    boundaryRunning = false
    frozenMs = null
    mode = SleepMode.MINUTES
    endsAtMs = clock() + durationMs
    tick()
  }

  /** Stops at a chapter's or the episode's end; [remaining] is the listening time left. */
  fun startAtBoundary(mode: SleepMode, remaining: () -> Long) {
    frozenMs = null
    endsAtMs = null
    this.mode = mode
    untilBoundary = remaining
    boundaryRunning = true
    tick()
  }

  /**
   * Adds time. A chapter or episode timer becomes a plain countdown of what was left plus
   * [ms]: the listener asked for more time, not for the next chapter.
   */
  fun extend(ms: Long) {
    val remaining = remainingMs?.coerceAtLeast(0L) ?: return
    val running = isRunning
    when {
      untilBoundary != null -> {
        start(remaining + ms)
        if (!running) freeze()
      }
      endsAtMs != null -> endsAtMs = endsAtMs!! + ms
      else -> frozenMs = remaining + ms
    }
    if (isRunning) tick()
  }

  fun cancel() {
    if (!isActive) return
    clear()
    onVolume(1f)
  }

  /** The boundary was reached (or the countdown ran out): pause, then restore the volume. */
  fun finish() {
    if (!isActive) return
    clear()
    onFinished()
    // Restore after pausing so the next play is at normal volume.
    onVolume(1f)
  }

  fun freeze() {
    if (!isRunning) return
    if (untilBoundary != null) {
      boundaryRunning = false
      return
    }
    val remaining = remainingMs ?: return
    endsAtMs = null
    frozenMs = remaining.coerceAtLeast(0L)
  }

  fun resume() {
    if (untilBoundary != null) {
      if (boundaryRunning) return
      boundaryRunning = true
      tick()
      return
    }
    val remaining = frozenMs ?: return
    frozenMs = null
    endsAtMs = clock() + remaining
    tick()
  }

  fun tick() {
    if (!isRunning) return
    val remaining = remainingMs ?: return
    val due = if (untilBoundary != null) remaining <= -BOUNDARY_OVERRUN_MS else remaining <= 0
    if (due) finish() else onVolume(fadeVolume(remaining))
  }

  private fun clear() {
    endsAtMs = null
    frozenMs = null
    untilBoundary = null
    boundaryRunning = false
    mode = null
  }
}
