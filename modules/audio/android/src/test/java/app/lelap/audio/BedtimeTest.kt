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
}
