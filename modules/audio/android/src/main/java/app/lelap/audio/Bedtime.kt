package app.lelap.audio

import org.json.JSONObject

private const val DAY_MS = 86_400_000L
private const val DAY_MINUTES = 24 * 60

/**
 * The bedtime routine: between [startMinute] and [endMinute] (minutes after local midnight; the
 * window may cross midnight) the service starts a timer for [minutes], or to the end of the
 * chapter when [chapter] is set, and plays at [volume] percent until the timer ends. It starts
 * when the window opens while playing (M86, see [BedtimeAlarm]) or when Play falls inside it
 * (M33). Once per night, so a timer the listener turned off stays off.
 */
data class Bedtime(
  val startMinute: Int,
  val endMinute: Int,
  val chapter: Boolean,
  val minutes: Int,
  val volume: Int = 100,
) {
  /** The player's gain while the routine's timer runs. */
  val gain: Float
    get() = volume / 100f

  /**
   * The local day the window that contains this moment opened on, or null outside the window. A
   * window from 22:00 to 02:00 that is open at 01:00 opened the day before.
   */
  fun nightOf(epochDay: Long, minuteOfDay: Int): Long? {
    val start = startMinute.mod(DAY_MINUTES)
    val end = endMinute.mod(DAY_MINUTES)
    return when {
      // An empty window, rather than a whole day: a timer at every start is never wanted.
      start == end -> null
      start < end -> epochDay.takeIf { minuteOfDay in start until end }
      minuteOfDay >= start -> epochDay
      minuteOfDay < end -> epochDay - 1
      else -> null
    }
  }

  fun encode(): String = JSONObject()
    .put("startMinute", startMinute)
    .put("endMinute", endMinute)
    .put("chapter", chapter)
    .put("minutes", minutes)
    .put("volume", volume)
    .toString()

  companion object {
    const val MIN_VOLUME = 10

    /** Null when off or unreadable. */
    fun decode(json: String?): Bedtime? = try {
      json?.let(::JSONObject)?.let {
        Bedtime(
          startMinute = it.getInt("startMinute"),
          endMinute = it.getInt("endMinute"),
          chapter = it.optBoolean("chapter", false),
          minutes = it.optInt("minutes", 30).coerceIn(1, 24 * 60),
          // Never silent: a routine that mutes would look like a broken player.
          volume = it.optInt("volume", 100).coerceIn(MIN_VOLUME, 100),
        )
      }
    } catch (e: Exception) {
      null
    }

    /** The local day and minute of [nowMs], given the zone's offset from UTC at that moment. */
    fun localClock(nowMs: Long, offsetMs: Int): Pair<Long, Int> {
      val local = nowMs + offsetMs
      return Math.floorDiv(local, DAY_MS) to (Math.floorMod(local, DAY_MS) / 60_000L).toInt()
    }

    /**
     * The night that Play now opens, or null: outside the window, or a night already handled.
     * The service then starts a timer unless one is set already.
     */
    fun nightToMark(bedtime: Bedtime?, epochDay: Long, minuteOfDay: Int, lastNight: Long?): Long? =
      bedtime?.nightOf(epochDay, minuteOfDay)?.takeIf { it != lastNight }

    /**
     * When the window next opens after [nowMs], in wall-clock milliseconds; null when off or the
     * window is empty. [offsetAt] is the zone's offset from UTC at a moment, so a change of
     * daylight saving time between now and then still lands on the local start minute.
     */
    fun nextStartMs(bedtime: Bedtime?, nowMs: Long, offsetAt: (Long) -> Int): Long? {
      if (bedtime == null) return null
      val start = bedtime.startMinute.mod(DAY_MINUTES)
      if (start == bedtime.endMinute.mod(DAY_MINUTES)) return null
      val (today, _) = localClock(nowMs, offsetAt(nowMs))
      for (day in today..today + 2) {
        val local = day * DAY_MS + start * 60_000L
        // The offset at the guess, then once more at the corrected time.
        var at = local - offsetAt(local)
        at = local - offsetAt(at)
        if (at > nowMs) return at
      }
      return null
    }
  }
}
