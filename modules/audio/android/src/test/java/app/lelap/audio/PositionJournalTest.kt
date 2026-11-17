package app.lelap.audio

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
    assertEquals(0L, load?.playlist?.introMs)
  }

  @Test
  fun keepsAPodcastsIntroAndOutroThroughTheJournal() {
    val json = """
      {"bookId":"b","title":"T","author":null,"coverUri":null,"speed":1,
       "files":[{"uri":"content://x","location":"loc","title":"x","durationMs":5}],
       "chapters":[],"startIndex":0,"startPositionMs":0,"skipIntroMs":30000,"skipOutroMs":15000}
    """.trimIndent()
    val load = PositionJournal.decodeLoad(json)!!
    assertEquals(30_000L, load.playlist.introMs)
    assertEquals(15_000L, load.playlist.outroMs)
    assertEquals(load, PositionJournal.decodeLoad(PositionJournal.encodeLoad(load)))
  }

  @Test
  fun returnsNullForCorruptJson() {
    assertNull(PositionJournal.decode("{not json"))
    assertNull(PositionJournal.decode("""{"entry":{}}"""))
    assertNull(PositionJournal.decodeLoad(""))
  }

  @Test
  fun rejectsABookLoadWithoutFiles() {
    val json = """{"bookId":"b","title":"T","author":null,"coverUri":null,"speed":1,"files":[],"chapters":[],"startIndex":0,"startPositionMs":0}"""
    assertNull(PositionJournal.decodeLoad(json))
  }

  @Test
  fun recordsAnEntryOnlyForTheItemThatIsPlaying() {
    assertEquals(
      JournalEntry("book-1", "primary:Books/Bog/02.mp3", 500, 9),
      PositionJournal.entryFor(playlist, 1, "primary:Books/Bog/02.mp3", 500, 9),
    )
    assertNull(PositionJournal.entryFor(playlist, 1, "primary:Other/x.mp3", 500, 9))
    assertNull(PositionJournal.entryFor(playlist, 5, "primary:Books/Bog/02.mp3", 500, 9))
    assertNull(PositionJournal.entryFor(null, 0, "primary:Books/Bog/01.mp3", 500, 9))
  }

  @Test
  fun knowsWhenALoadIsTheBookAlreadyLoaded() {
    val load = BookLoad(playlist, 0, 0)
    assertTrue(PositionJournal.isSameBook(playlist, 2, load))
    assertFalse(PositionJournal.isSameBook(playlist, 0, load))
    assertFalse(PositionJournal.isSameBook(null, 2, load))
    assertFalse(PositionJournal.isSameBook(playlist.copy(bookId = "other"), 2, load))
  }
}
