package app.lelap.audio

import app.lelap.audio.PositionJournal.Event
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PositionJournalTest {
  private val playlist = BookPlaylist(
    bookId = "book-1",
    title = "Møgtøs: Unåde",
    author = "Ærø Åse",
    coverUri = null,
    files = listOf(
      BookFile("content://a", "primary:Books/Bog/01.mp3", "Første del", 1_000),
      BookFile("content://b", "primary:Books/Bog/02.mp3", "Anden del", 2_000),
    ),
    chapters = listOf(ChapterMark("Kapitel 1", 0), ChapterMark("Kapitel 2", 1_500)),
    speed = 1.25f,
  )

  @Test
  fun roundTripsAnEntryAndItsPlaylist() {
    val entry = JournalEntry("book-1", "primary:Books/Bog/02.mp3", 734_000, 1_763_300_000_000)
    assertEquals(entry to playlist, PositionJournal.decode(PositionJournal.encode(entry, playlist)))
  }

  @Test
  fun decodesTheAppsBookLoad() {
    val json = """
      {"bookId":"b","title":"T","author":null,"coverUri":null,"speed":1,
       "files":[{"uri":"content://x","location":"loc","title":"x","durationMs":5}],
       "chapters":[],"startIndex":0,"startPositionMs":42}
    """.trimIndent()
    val load = PositionJournal.decodeLoad(json)
    assertEquals("b", load?.playlist?.bookId)
    assertEquals(42L, load?.startPositionMs)
    assertEquals(null, load?.playlist?.author)
  }

  @Test
  fun returnsNullForCorruptJson() {
    assertNull(PositionJournal.decode("{not json"))
    assertNull(PositionJournal.decode("""{"entry":{}}"""))
    assertNull(PositionJournal.decodeLoad(""))
  }

  @Test
  fun writesTicksEveryTenSeconds() {
    assertFalse(PositionJournal.shouldWrite(lastWriteAt = 0, now = 9_999, Event.TICK))
    assertTrue(PositionJournal.shouldWrite(lastWriteAt = 0, now = 10_000, Event.TICK))
  }

  @Test
  fun writesEveryOtherEventAtOnce() {
    for (event in Event.entries - Event.TICK) {
      assertTrue(event.name, PositionJournal.shouldWrite(lastWriteAt = 0, now = 1, event))
    }
  }
}
