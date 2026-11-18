package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BedtimeTest {
  private fun window(start: String, end: String) = Bedtime(minute(start), minute(end), chapter = false, minutes = 30)

  private fun minute(clock: String): Int {
    val (h, m) = clock.split(":").map(String::toInt)
    return h * 60 + m
  }

  @Test
  fun sameDayWindowIncludesStartAndExcludesEnd() {
    val w = window("20:00", "23:00")
    assertEquals(10L, w.nightOf(10, minute("20:00")))
    assertEquals(10L, w.nightOf(10, minute("22:59")))
    assertNull(w.nightOf(10, minute("23:00")))
    assertNull(w.nightOf(10, minute("19:59")))
  }

  @Test
  fun windowAcrossMidnightBelongsToTheNightItOpened() {
    val w = window("22:00", "02:00")
    assertEquals(10L, w.nightOf(10, minute("22:00")))
    assertEquals(10L, w.nightOf(10, minute("23:59")))
    assertEquals(9L, w.nightOf(10, minute("00:00")))
    assertEquals(9L, w.nightOf(10, minute("01:59")))
    assertNull(w.nightOf(10, minute("02:00")))
    assertNull(w.nightOf(10, minute("12:00")))
    assertNull(w.nightOf(10, minute("21:59")))
  }

  @Test
  fun emptyWindowNeverMatches() {
    val w = window("22:00", "22:00")
    assertNull(w.nightOf(10, minute("22:00")))
    assertNull(w.nightOf(10, minute("03:00")))
  }

  @Test
  fun handlesEachNightOnce() {
    val w = window("22:00", "02:00")
    assertEquals(10L, Bedtime.nightToMark(w, 10, minute("23:00"), lastNight = null))
    // Already handled tonight, also after midnight: the listener may have turned the timer off.
    assertNull(Bedtime.nightToMark(w, 10, minute("23:30"), lastNight = 10))
    assertNull(Bedtime.nightToMark(w, 11, minute("01:00"), lastNight = 10))
    // The next night starts again.
    assertEquals(11L, Bedtime.nightToMark(w, 11, minute("22:30"), lastNight = 10))
  }

  @Test
  fun doesNothingWhenOffOrOutside() {
    assertNull(Bedtime.nightToMark(null, 10, minute("23:00"), lastNight = null))
    assertNull(Bedtime.nightToMark(window("22:00", "02:00"), 10, minute("15:00"), lastNight = null))
  }

  @Test
  fun localClockAppliesTheOffset() {
    // 1970-01-02 23:30 UTC is 01:30 on 1970-01-03 at UTC+2.
    val now = 86_400_000L + (23 * 60 + 30) * 60_000L
    assertEquals(1L to minute("23:30"), Bedtime.localClock(now, 0))
    assertEquals(2L to minute("01:30"), Bedtime.localClock(now, 2 * 3_600_000))
    // Before the epoch in a zone behind UTC still gives a day and a minute in range.
    assertEquals(-1L to minute("19:00"), Bedtime.localClock(0L, -5 * 3_600_000))
  }

  @Test
  fun encodesAndDecodes() {
    val w = Bedtime(minute("22:30"), minute("01:00"), chapter = true, minutes = 45)
    assertEquals(w, Bedtime.decode(w.encode()))
    assertNull(Bedtime.decode(null))
    assertNull(Bedtime.decode("not json"))
  }

  @Test
  fun keepsTheRoutineVolumeAndNeverMutes() {
    val w = Bedtime(minute("22:00"), minute("02:00"), chapter = false, minutes = 30, volume = 60)
    assertEquals(w, Bedtime.decode(w.encode()))
    assertEquals(0.6f, w.gain, 1e-6f)
    // A window saved before M86 plays at full volume.
    val old = """{"startMinute":1320,"endMinute":120,"chapter":false,"minutes":30}"""
    assertEquals(100, Bedtime.decode(old)?.volume)
    val silent = """{"startMinute":1320,"endMinute":120,"chapter":false,"minutes":30,"volume":0}"""
    assertEquals(Bedtime.MIN_VOLUME, Bedtime.decode(silent)?.volume)
  }

  private val hour = 3_600_000L
  private val day = 24 * hour

  @Test
  fun nextStartIsTonightOrTomorrow() {
    val w = window("22:00", "02:00")
    // Day 10, 21:00 UTC: tonight at 22:00.
    assertEquals(10 * day + 22 * hour, Bedtime.nextStartMs(w, 10 * day + 21 * hour) { 0 })
    // Exactly at the start, or after it: tomorrow, as the alarm sets the next one when it fires.
    assertEquals(11 * day + 22 * hour, Bedtime.nextStartMs(w, 10 * day + 22 * hour) { 0 })
    assertEquals(11 * day + 22 * hour, Bedtime.nextStartMs(w, 10 * day + 23 * hour) { 0 })
    assertEquals(11 * day + 22 * hour, Bedtime.nextStartMs(w, 11 * day + 1 * hour) { 0 })
  }

  @Test
  fun nextStartFollowsTheLocalZone() {
    val w = window("22:00", "02:00")
    // At UTC+2, 22:00 local is 20:00 UTC.
    assertEquals(10 * day + 20 * hour, Bedtime.nextStartMs(w, 10 * day + 12 * hour) { (2 * hour).toInt() })
    // Summer time ends before tonight: the offset at the start counts, not the one now.
    val change = 10 * day + 18 * hour
    val offset = { at: Long -> (if (at < change) 2 * hour else 1 * hour).toInt() }
    assertEquals(10 * day + 21 * hour, Bedtime.nextStartMs(w, 10 * day + 12 * hour, offset))
  }

  @Test
  fun noNextStartWhenOffOrEmpty() {
    assertNull(Bedtime.nextStartMs(null, 0L) { 0 })
    assertNull(Bedtime.nextStartMs(window("22:00", "22:00"), 0L) { 0 })
  }
}
