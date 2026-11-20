package app.lelap.cast

import kotlin.math.ceil

/**
 * How long [RemoteSession] takes a receiver's statuses as stale after a command, tuned from what
 * this receiver measured (M139). Until it has answered a few times, the defaults hold; then a
 * wait is the slower answers (the 90th percentile) and half again, plus a poll, inside bounds.
 * A quick speaker comes back to the listener's view sooner when it is changed on the speaker
 * itself; a slow one no longer flickers back to the old state while it catches up.
 */
class ReceiverWaits {
  private val commands = Samples()
  private val loads = Samples()

  /** A timing [RemoteSession] measured: `play`, `pause` and `seek` tune one wait, `load` the other. */
  fun learn(timing: RemoteSession.Timing) {
    when (timing.what) {
      "play", "pause", "seek" -> commands.add(timing.ms)
      "load" -> loads.add(timing.ms)
    }
  }

  /** After a play, pause or seek. */
  val commandSettleMs: Long
    get() = commands.tuned(COMMAND_SETTLE_MS, MIN_COMMAND_MS, MAX_COMMAND_MS)

  /** After a load: receivers report a stop or an idle moment while they start the file. */
  val loadSettleMs: Long
    get() = loads.tuned(LOAD_SETTLE_MS, MIN_LOAD_MS, MAX_LOAD_MS)

  private class Samples {
    private val values = ArrayDeque<Long>()

    fun add(ms: Long) {
      values.addLast(ms.coerceAtLeast(0L))
      while (values.size > KEEP) values.removeFirst()
    }

    fun tuned(default: Long, min: Long, max: Long): Long {
      if (values.size < ENOUGH) return default
      val sorted = values.sorted()
      val slow = sorted[(ceil(sorted.size * 0.9).toInt() - 1).coerceIn(0, sorted.lastIndex)]
      return (slow * 3 / 2 + POLL_MS).coerceIn(min, max)
    }
  }

  companion object {
    /** The waits before any receiver was measured (M50). */
    const val COMMAND_SETTLE_MS = 2_500L
    const val LOAD_SETTLE_MS = 5_000L

    // Never shorter than two polls apart, nor longer than a listener would wait for the view.
    const val MIN_COMMAND_MS = 1_500L
    const val MAX_COMMAND_MS = 8_000L
    const val MIN_LOAD_MS = 2_500L
    const val MAX_LOAD_MS = 15_000L

    /** Statuses come a second apart, so an answer is seen up to a poll late. */
    const val POLL_MS = 1_000L

    const val ENOUGH = 3
    const val KEEP = 20
  }
}
