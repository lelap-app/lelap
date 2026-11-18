package app.lelap.cast

/**
 * What discovery did, for the sheet, for logcat and for the diagnostics log. Only words from
 * [WHATS] and [KINDS], counts and NsdManager's error codes: no names, addresses or service names,
 * the same rule as the app's diagnostics log.
 */
class DiscoveryLog(
  private val clock: () -> Long = System::currentTimeMillis,
  private val onRecord: (what: String, kind: String, code: Int?) -> Unit = { _, _, _ -> },
) {
  data class Event(val at: Long, val what: String, val kind: String, val code: Int?, val count: Int)

  private class Tally {
    var startFailed: Int? = null
    var found = 0
    var added = 0
    var lastFailure: String? = null
    var lastFailureCode: Int? = null
  }

  // Grouped by what, kind and code, so a search that finds the same speaker every few seconds
  // takes one line of the diagnostics log, not hundreds.
  private val pending = LinkedHashMap<String, Event>()
  private val tallies = LinkedHashMap<String, Tally>()
  private var searching = false

  @Synchronized
  fun begin() {
    tallies.clear()
    searching = true
  }

  @Synchronized
  fun end() {
    searching = false
  }

  /** Returns true when the summary changed. */
  @Synchronized
  fun record(what: String, kind: String, code: Int? = null): Boolean {
    require(what in WHATS && kind in KINDS)
    onRecord(what, kind, code)
    val key = "$what $kind ${code ?: ""}"
    val seen = pending[key]
    if (seen != null) {
      pending[key] = seen.copy(count = seen.count + 1)
    } else if (pending.size < MAX_PENDING) {
      pending[key] = Event(clock(), what, kind, code, 1)
    }
    val tally = tallies.getOrPut(kind) { Tally() }
    when (what) {
      // A search that started on its second try is no longer a problem.
      STARTED -> tally.startFailed = null
      START_FAILED -> tally.startFailed = code ?: CODE_THREW
      FOUND -> tally.found++
      ADDED -> tally.added++
      RESOLVE_FAILED, RESOLVE_TIMEOUT, NO_ADDRESS -> {
        tally.lastFailure = what
        tally.lastFailureCode = code
      }
      else -> return false
    }
    return true
  }

  /** The events since the last call, oldest first, each with how often it happened. */
  @Synchronized
  fun take(): List<Event> = pending.values.toList().also { pending.clear() }

  /**
   * For the sheet. `problem` is `start-failed` when an mDNS search could not start, or, when
   * mDNS found services but none could be added, the last reason one was dropped.
   */
  @Synchronized
  fun summary(): Map<String, Any?> {
    val mdns = MDNS_KINDS.mapNotNull { tallies[it] }
    val failedStart = MDNS_KINDS.firstNotNullOfOrNull { tallies[it]?.startFailed }
    val found = mdns.sumOf { it.found }
    val added = mdns.sumOf { it.added }
    val dropped = mdns.lastOrNull { it.lastFailure != null }
    val (problem, code) = when {
      failedStart != null -> START_FAILED to failedStart
      found > 0 && added == 0 && dropped != null -> dropped.lastFailure to dropped.lastFailureCode
      else -> null to null
    }
    return mapOf(
      "searching" to searching,
      "problem" to problem,
      "code" to code,
      "found" to found,
      "added" to added + (tallies[UPNP]?.added ?: 0),
    )
  }

  companion object {
    const val STARTED = "started"
    const val START_FAILED = "start-failed"
    const val STOP_FAILED = "stop-failed"
    const val FOUND = "found"
    const val RESOLVE_FAILED = "resolve-failed"
    const val RESOLVE_TIMEOUT = "resolve-timeout"
    const val NO_ADDRESS = "no-address"
    const val ADDED = "added"
    const val LOST = "lost"
    val WHATS = setOf(STARTED, START_FAILED, STOP_FAILED, FOUND, RESOLVE_FAILED, RESOLVE_TIMEOUT, NO_ADDRESS, ADDED, LOST)

    const val CAST = "cast"
    const val FCAST = "fcast"
    const val UPNP = "upnp"
    val KINDS = setOf(CAST, FCAST, UPNP)
    private val MDNS_KINDS = listOf(CAST, FCAST)

    /** Not an NsdManager code: the call itself threw. */
    const val CODE_THREW = -1

    /** Not an NsdManager code: it neither started the search nor said why within a few seconds. */
    const val CODE_NO_ANSWER = -2

    /** No local network access on Android 17; the same number as NsdManager's FAILURE_PERMISSION_DENIED. */
    const val CODE_NO_ACCESS = 7

    private const val MAX_PENDING = 64
  }
}
