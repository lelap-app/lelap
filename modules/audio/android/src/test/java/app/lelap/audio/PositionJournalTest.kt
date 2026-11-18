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
    val entry = JournalEntry("book-1", "primary:Books/Bog/02.mp3", 734_000, 1_763_300_000_000, 1_763_299_000_000)
    val entryJson = PositionJournal.encodeEntry(entry)
    assertEquals(entry to playlist, PositionJournal.decode(entryJson, PositionJournal.encodePlaylist(playlist)))
    assertEquals(entry, PositionJournal.decodeEntry(entryJson))
    // The place alone, written on every tick, carries none of the playlist.
    assertFalse(entryJson.contains("Kapitel"))
  }

  @Test
  fun readsTheOlderJournalThatCarriedItsPlaylist() {
    val old = """
      {"entry":{"bookId":"book-1","fileLocation":"primary:Books/Bog/02.mp3","filePositionMs":5,"savedAt":9},
       "playlist":${PositionJournal.encodePlaylist(playlist)}}
    """.trimIndent()
    val entry = JournalEntry("book-1", "primary:Books/Bog/02.mp3", 5, 9)
    assertEquals(entry to playlist, PositionJournal.decode(old, null))
    assertEquals(entry, PositionJournal.decodeEntry(old))
    assertNull(entry.pausedAt)
  }

  @Test
  fun resumesNothingWhenThePlaylistIsGoneOrAnotherBooks() {
    val entryJson = PositionJournal.encodeEntry(JournalEntry("book-1", "primary:Books/Bog/02.mp3", 5, 9))
    // Removed when another profile emptied the player: the place is kept, nothing resumes.
    assertNull(PositionJournal.decode(entryJson, null))
    assertNull(PositionJournal.decode(entryJson, PositionJournal.encodePlaylist(playlist.copy(bookId = "other"))))
    assertEquals("book-1", PositionJournal.decodeEntry(entryJson)?.bookId)
  }

  @Test
  fun smartRewindMeasuresThePauseItself() {
    // Paused at 100, then a seek while paused moved the place at 500.
    assertEquals(100L, JournalEntry("b", "f", 0, savedAt = 500, pausedAt = 100).pauseStartedAt)
    // Stopped while playing (the process died): the last saved place is the best guess.
    assertEquals(500L, JournalEntry("b", "f", 0, savedAt = 500).pauseStartedAt)
  }

  @Test
  fun keepsTheLiveSpeed() {
    assertEquals(2f, PositionJournal.withSpeed(playlist, 2f).speed)
    assertTrue(PositionJournal.withSpeed(playlist, 1.25f) === playlist)
    assertEquals(3f, PositionJournal.withSpeed(playlist, 9f).speed)
    val journaled = PositionJournal.withSpeed(playlist, 1.75f)
    val (_, decoded) = PositionJournal.decode(
      PositionJournal.encodeEntry(JournalEntry("book-1", "primary:Books/Bog/01.mp3", 0, 1)),
      PositionJournal.encodePlaylist(journaled),
    )!!
    assertEquals(1.75f, decoded.speed)
  }

  @Test
  fun seesWhenTheSameBookComesWithOtherFiles() {
    assertFalse(PositionJournal.filesChanged(playlist, playlist.copy(chapters = emptyList(), speed = 2f)))
    val downloaded = playlist.copy(files = playlist.files.map { it.copy(uri = "file:///downloads/${it.title}") })
    assertTrue(PositionJournal.filesChanged(playlist, downloaded))
    assertTrue(PositionJournal.filesChanged(playlist, playlist.copy(headers = mapOf("Authorization" to "Basic x"))))
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
  fun keepsAddressesWithALoginPrivateThroughTheJournal() {
    val json = """
      {"bookId":"b","title":"T","author":null,"coverUri":null,"speed":1,
       "files":[{"uri":"http://nas:4533/rest/stream?id=a&t=x&s=y","location":"loc","title":"x","durationMs":5}],
       "chapters":[],"startIndex":0,"startPositionMs":0,"privateUris":true}
    """.trimIndent()
    val load = PositionJournal.decodeLoad(json)!!
    assertTrue(load.playlist.privateUris)
    assertEquals(load, PositionJournal.decodeLoad(PositionJournal.encodeLoad(load)))
    assertFalse(PositionJournal.decodeLoad(json.replace(",\"privateUris\":true", ""))!!.playlist.privateUris)
  }

  @Test
  fun returnsNullForCorruptJson() {
    assertNull(PositionJournal.decode("{not json", null))
    assertNull(PositionJournal.decode("""{"entry":{}}""", null))
    assertNull(PositionJournal.decodeEntry("{not json"))
    assertNull(PositionJournal.decodeEntry(null))
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
    assertEquals(4L, PositionJournal.entryFor(playlist, 1, "primary:Books/Bog/02.mp3", 500, 9, pausedAt = 4)?.pausedAt)
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
