package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ListeningTallyTest {
  private val day = "2026-11-17"
  private fun log() = AccountingLog("epoch-1")
  private fun tally() = ListeningTally(dayOf = { day }, progressEveryMs = 300_000)

  private fun heard(
    position: Long,
    playing: Boolean = true,
    book: String = "book-1",
    file: Int = 0,
    speed: Float = 1f,
    engaged: Boolean = playing,
  ) = Heard(book, "Title of $book", file, "$book/$file.mp3", position, playing, engaged, speed)

  private fun AccountingLog.listened() = records.filterIsInstance<Listened>()
  private fun AccountingLog.events() = records.filterIsInstance<SessionEvent>().map { it.kind to it.filePositionMs }

  @Test
  fun countsTheTimeThatPassedWhilePlaying() {
    val log = log()
    val t = tally()
    t.observe(log, heard(0), elapsedMs = 1_000, wallMs = 0)
    t.observe(log, heard(10_000), elapsedMs = 11_000, wallMs = 10_000)
    t.observe(log, heard(20_000), elapsedMs = 21_000, wallMs = 20_000)
    t.observe(log, heard(25_000, playing = false), elapsedMs = 26_000, wallMs = 25_000)
    assertEquals(listOf(Listened(2, "book-1", "Title of book-1", day, 25_000)), log.listened())
    assertEquals(listOf("start" to 0L, "pause" to 25_000L), log.events())
  }

  @Test
  fun aFastSpeedStillCountsWallTime() {
    val log = log()
    val t = tally()
    t.observe(log, heard(0, speed = 2f), 0, 0)
    t.observe(log, heard(20_000, speed = 2f), 10_000, 10_000)
    assertEquals(10_000L, log.listened().single().ms)
  }

  @Test
  fun aSpeedChangeCountsEachIntervalAtItsOwnSpeed() {
    val log = log()
    val t = tally()
    t.observe(log, heard(0), 0, 0)
    // Switched to 2× after 9 s at 1×: observed as it happens.
    t.observe(log, heard(9_000, speed = 2f), 9_000, 9_000)
    t.observe(log, heard(11_000, speed = 2f), 10_000, 10_000)
    assertEquals(10_000L, log.listened().single().ms)
  }

  @Test
  fun aSkipForwardCountsOnlyTheTimeThatPassed() {
    val log = log()
    val t = tally()
    t.observe(log, heard(0), 0, 0)
    // A jump the service missed: the position ran far ahead of the clock.
    t.observe(log, heard(600_000), 10_000, 10_000)
    assertEquals(10_000L, log.listened().single().ms)
  }

  @Test
  fun aSeekCountsUpToItAndGoesOnFromTheNewPlace() {
    val log = log()
    val t = tally()
    t.observe(log, heard(100_000), 0, 0)
    t.jumped(log, heard(104_000), heard(50_000), 4_000, 4_000)
    t.observe(log, heard(56_000), 10_000, 10_000)
    assertEquals(10_000L, log.listened().single().ms)
    // A seek keeps the session going.
    assertEquals(listOf("start" to 100_000L), log.events())
  }

  @Test
  fun theNextFileCountsFromItsStart() {
    val log = log()
    val t = tally()
    t.observe(log, heard(55_000), 0, 0)
    t.jumped(log, heard(60_000), heard(0, file = 1), 5_000, 5_000)
    t.observe(log, heard(5_000, file = 1), 10_000, 10_000)
    assertEquals(10_000L, log.listened().single().ms)
  }

  @Test
  fun bufferingCountsNothingButKeepsTheSession() {
    val log = log()
    val t = tally()
    t.observe(log, heard(0), 0, 0)
    t.observe(log, heard(5_000, playing = false, engaged = true), 5_000, 5_000)
    t.observe(log, heard(5_000), 35_000, 35_000)
    t.observe(log, heard(10_000), 40_000, 40_000)
    assertEquals(10_000L, log.listened().single().ms)
    assertEquals(listOf("start" to 0L), log.events())
  }

  @Test
  fun sendsProgressAboutEveryFiveMinutes() {
    val log = log()
    val t = tally()
    var at = 0L
    while (at <= 660_000L) {
      t.observe(log, heard(at), at, at)
      at += 10_000
    }
    // The second progress replaced the first, which nobody had taken yet.
    assertEquals(listOf("start" to 0L, "progress" to 600_000L), log.events())
    val progress = log.records.filterIsInstance<SessionEvent>()[1]
    assertEquals("book-1/0.mp3", progress.startLocation)
    assertEquals(0L, progress.startPositionMs)
  }

  @Test
  fun aProgressAlreadyTakenStays() {
    val log = log()
    val t = tally()
    var at = 0L
    while (at <= 300_000L) {
      t.observe(log, heard(at), at, at)
      at += 10_000
    }
    log.take()
    while (at <= 600_000L) {
      t.observe(log, heard(at), at, at)
      at += 10_000
    }
    assertEquals(listOf("start" to 0L, "progress" to 300_000L, "progress" to 600_000L), log.events())
  }

  @Test
  fun weeksWithTheAppClosedKeepOneTotalPerBookAndDay() {
    val log = log()
    val t = tally()
    var at = 0L
    // 30 hours of one book on one day, with a progress event every 5 minutes in between.
    while (at <= 30 * 3_600_000L) {
      t.observe(log, heard(at), at, at)
      at += 10_000
    }
    assertEquals(listOf(30 * 3_600_000L), log.listened().map { it.ms })
    assertEquals(listOf("start" to 0L, "progress" to 30 * 3_600_000L), log.events())
  }

  @Test
  fun anotherBookEndsTheFirstOnesSession() {
    val log = log()
    val t = tally()
    t.observe(log, heard(0), 0, 0)
    t.observe(log, heard(10_000), 10_000, 10_000)
    t.observe(log, heard(0, book = "book-2"), 11_000, 11_000)
    t.observe(log, heard(9_000, book = "book-2"), 20_000, 20_000)
    assertEquals(listOf("book-1" to 10_000L, "book-2" to 9_000L), log.listened().map { it.bookId to it.ms })
    val events = log.records.filterIsInstance<SessionEvent>().map { Triple(it.kind, it.bookId, it.filePositionMs) }
    assertEquals(
      listOf(Triple("start", "book-1", 0L), Triple("pause", "book-1", 10_000L), Triple("start", "book-2", 0L)),
      events,
    )
  }

  @Test
  fun theDayComesFromTheWallClockAndTimeFromElapsed() {
    val log = log()
    val t = ListeningTally(dayOf = { wall -> if (wall < 50_000) "2026-11-16" else "2026-11-17" })
    t.observe(log, heard(0), 0, 40_000)
    t.observe(log, heard(10_000), 10_000, 49_000)
    // The clock jumped back an hour; listening still counts what elapsed.
    t.observe(log, heard(20_000), 20_000, 60_000 - 3_600_000)
    t.observe(log, heard(30_000), 30_000, 70_000)
    assertEquals(
      listOf("2026-11-16" to 20_000L, "2026-11-17" to 10_000L),
      log.listened().map { it.day to it.ms },
    )
  }

  @Test
  fun whatWasTakenIsNeverChangedAgain() {
    val log = log()
    val t = tally()
    t.observe(log, heard(0), 0, 0)
    t.observe(log, heard(10_000), 10_000, 10_000)
    val taken = log.take()
    t.observe(log, heard(20_000), 20_000, 20_000)
    assertEquals(10_000L, (taken.single { it is Listened } as Listened).ms)
    assertEquals(listOf(10_000L, 10_000L), log.listened().map { it.ms })
    log.ack("epoch-1", taken.maxOf { it.seq })
    assertEquals(listOf(10_000L), log.listened().map { it.ms })
    assertNotEquals(taken.last().seq, log.records.single().seq)
  }

  @Test
  fun anAckForAnotherEpochChangesNothing() {
    val log = log()
    val t = tally()
    t.observe(log, heard(0), 0, 0)
    t.observe(log, heard(10_000), 10_000, 10_000)
    log.take()
    log.ack("an-older-log", 100)
    assertEquals(2, log.records.size)
  }

  @Test
  fun aSessionLeftOpenByProcessDeathEndsWithAPause() {
    val log = log()
    tally().apply {
      observe(log, heard(0), 0, 0)
      observe(log, heard(10_000), 10_000, 10_000)
    }
    val restored = AccountingLog.decode(log.encode()) { "fresh" }
    val t = tally()
    t.recover(restored)
    assertNull(restored.session)
    val pause = restored.records.filterIsInstance<SessionEvent>().last()
    assertEquals("pause" to 10_000L, pause.kind to pause.filePositionMs)
    assertEquals(10_000L, pause.at)
    // Nothing is counted for the time the process was gone.
    t.observe(restored, heard(500_000), 600_000, 600_000)
    assertEquals(10_000L, restored.listened().sumOf { it.ms })
  }

  @Test
  fun roundTripsTheLog() {
    val log = log()
    val t = tally()
    t.observe(log, heard(0), 0, 0)
    t.observe(log, heard(10_000), 10_000, 10_000)
    log.take()
    val decoded = AccountingLog.decode(log.encode()) { "fresh" }
    assertEquals(log.encode(), decoded.encode())
    assertEquals("epoch-1", decoded.epoch)
    assertEquals(log.records, decoded.records)
  }

  @Test
  fun anUnreadableLogStartsAFreshEpoch() {
    assertEquals("fresh", AccountingLog.decode("{not json", { "fresh" }).epoch)
    assertEquals("fresh", AccountingLog.decode(null, { "fresh" }).epoch)
  }

  @Test
  fun aLongAbsenceDropsProgressBeforeListening() {
    val log = log()
    log.addListening("book-1", "T", day, 1_000)
    // Progress of as many sessions; one session's progress replaces its own earlier one.
    repeat(AccountingLog.MAX_RECORDS + 10) { log.addEvent("progress", "book-1", it.toLong(), "f", 0, "f" to it.toLong()) }
    assertEquals(AccountingLog.MAX_RECORDS, log.records.size)
    assertTrue(log.records.first() is Listened)
  }

  @Test
  fun localDays() {
    assertEquals("1970-01-01", LocalDay.key(0, 0))
    assertEquals("2026-11-17", LocalDay.key(1_794_873_600_000, 0))
    // 23:30 UTC on the 16th is already the 17th an hour east.
    assertEquals("2026-11-17", LocalDay.key(1_794_871_800_000, 3_600_000))
    assertEquals("2024-02-29", LocalDay.key(1_709_164_800_000, 0))
    assertEquals("1969-12-31", LocalDay.key(-1, 0))
    // Persian digits are the default there; the app needs ASCII ones.
    val before = java.util.Locale.getDefault()
    try {
      java.util.Locale.setDefault(java.util.Locale.forLanguageTag("fa-IR"))
      assertEquals("2026-11-17", LocalDay.key(1_794_873_600_000, 0))
    } finally {
      java.util.Locale.setDefault(before)
    }
  }
}
