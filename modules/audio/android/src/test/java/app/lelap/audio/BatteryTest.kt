package app.lelap.audio

import androidx.media3.common.C
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BatteryTest {
  private fun book(chapterStarts: List<Long>, artworks: List<Long> = emptyList()) = BookPlaylist(
    bookId = "b",
    title = "Book",
    author = null,
    coverUri = null,
    files = listOf(BookFile("file:///a.mp3", "a", "A", 3_600_000), BookFile("file:///b.mp3", "b", "B", 3_600_000)),
    chapters = chapterStarts.mapIndexed { i, start -> ChapterMark("Chapter ${i + 1}", start) },
    speed = 1f,
    artworks = artworks.map { ArtworkMark(it, null) },
  )

  /** Counts the sleep timer's wakeups over a countdown of [totalMs], as the service runs them. */
  private fun sleepTicks(totalMs: Long): Int {
    var remaining = totalMs
    var ticks = 0
    while (remaining > 0) {
      remaining -= Battery.sleepTickMs(remaining)
      ticks++
    }
    return ticks
  }

  @Test fun sleepTimerTicksSlowlyUntilTheFade() {
    assertEquals(Battery.TIMER_SLOW_TICK_MS, Battery.sleepTickMs(30 * 60_000L))
    assertEquals(Battery.TIMER_SLOW_TICK_MS, Battery.sleepTickMs(SLEEP_TIMER_FADE_MS + 10_000))
    // Lands on the fade's start, then steps a quarter second at a time through it.
    assertEquals(3_000L, Battery.sleepTickMs(SLEEP_TIMER_FADE_MS + 3_000))
    assertEquals(Battery.TIMER_FADE_TICK_MS, Battery.sleepTickMs(SLEEP_TIMER_FADE_MS))
    assertEquals(Battery.TIMER_FADE_TICK_MS, Battery.sleepTickMs(1_000))
    assertEquals(Battery.TIMER_FADE_TICK_MS, Battery.sleepTickMs(-500))
    assertEquals(Battery.TIMER_SLOW_TICK_MS, Battery.sleepTickMs(null))
  }

  @Test fun aHalfHourTimerWakesAboutAtwelfthAsOften() {
    // Before M106: every 250 ms for the whole half hour.
    val before = (30 * 60_000L / 250L).toInt()
    val after = sleepTicks(30 * 60_000L)
    assertEquals(7_200, before)
    assertEquals(588, after)
  }

  @Test fun chapterTitleWakesAtTheNextMark() {
    val playlist = book(listOf(0, 600_000, 1_200_000, 4_000_000))
    // Ten minutes to the next chapter: wait the longest, and look again.
    assertEquals(Battery.CHAPTER_TICK_MAX_MS, Battery.chapterTickMs(playlist, 0, 0, 1f))
    // Twenty seconds to go at double speed: ten seconds of real time, and a moment more.
    assertEquals(10_050L, Battery.chapterTickMs(playlist, 0, 580_000, 2f))
    // In the second file the marks count from the book's start.
    assertEquals(5_050L, Battery.chapterTickMs(playlist, 1, 395_000, 1f))
    // Nothing more to change: the longest wait.
    assertEquals(Battery.CHAPTER_TICK_MAX_MS, Battery.chapterTickMs(playlist, 1, 1_000_000, 1f))
    // A chapter picture is a mark too.
    assertEquals(1_050L, Battery.chapterTickMs(book(emptyList(), listOf(60_000)), 0, 59_000, 1f))
    // A mark right ahead never makes the wait shorter than a quarter second.
    assertEquals(Battery.CHAPTER_TICK_MIN_MS, Battery.chapterTickMs(playlist, 0, 599_990, 1f))
  }

  @Test fun anHourOfChaptersWakesAFractionAsOften() {
    // Chapters every 20 minutes over two hours, played at 1×.
    val playlist = book((0 until 6).map { it * 1_200_000L })
    var position = 0L
    var wakeups = 0
    while (position < 3_600_000) {
      position += Battery.chapterTickMs(playlist, 0, position, 1f)
      wakeups++
    }
    // Before M106: once a second.
    assertEquals(3_600, (3_600_000 / 1_000))
    assertTrue("$wakeups", wakeups in 120..125)
  }

  @Test fun theAppHearsTheStateLessOftenInTheBackground() {
    assertEquals(1_000L, Battery.stateTickMs(false))
    assertEquals(10_000L, Battery.stateTickMs(true))
  }

  @Test fun filesOnThePhoneHoldNoWifiLock() {
    assertEquals(C.WAKE_MODE_LOCAL, Battery.wakeModeFor(listOf("file:///data/a.mp3", "content://media/b")))
    assertEquals(C.WAKE_MODE_LOCAL, Battery.wakeModeFor(listOf("/storage/emulated/0/a.mp3")))
    assertEquals(C.WAKE_MODE_NETWORK, Battery.wakeModeFor(listOf("file:///a.mp3", "https://example.org/b.mp3")))
    assertEquals(C.WAKE_MODE_NETWORK, Battery.wakeModeFor(listOf("smb://nas/a.mp3")))
    assertEquals(C.WAKE_MODE_NETWORK, Battery.wakeModeFor(emptyList()))
  }
}
