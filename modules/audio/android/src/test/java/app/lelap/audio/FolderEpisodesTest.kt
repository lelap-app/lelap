package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FolderEpisodesTest {
  private fun file(n: Int, played: Boolean = false, leftAtMs: Long = 0L) =
    BookFile("https://x/e$n.mp3", "e$n", "Episode $n", 60_000, played = played, leftAtMs = leftAtMs)

  private fun book(vararg files: BookFile, skipsPlayed: Boolean = true) = BookPlaylist(
    "show", "Bandeland", null, null, files.toList(), emptyList(), 1f,
    skipsPlayed = skipsPlayed, marksFiles = true,
  )

  @Test fun `playing on into a played episode goes on to the next one not played, where it was left`() {
    val playlist = book(file(1), file(2, played = true), file(3, played = true), file(4, leftAtMs = 9_000), file(5))
    assertEquals(3 to 9_000L, FolderEpisodes.skipTarget(playlist, 0, 1))
  }

  @Test fun `nothing is skipped for a book, a jump, an unplayed episode or when all after are played`() {
    val playlist = book(file(1), file(2, played = true), file(3))
    assertNull(FolderEpisodes.skipTarget(playlist.copy(skipsPlayed = false), 0, 1))
    // The listener chose it: not reached by playing on.
    assertNull(FolderEpisodes.skipTarget(playlist, 2, 1))
    assertNull(FolderEpisodes.skipTarget(playlist, 1, 2))
    assertNull(FolderEpisodes.skipTarget(book(file(1), file(2, played = true)), 0, 1))
  }

  @Test fun `a file played to its end counts as played for the rest of the load`() {
    val playlist = FolderEpisodes.withPlayed(book(file(1, leftAtMs = 5_000), file(2), file(3)), 0)
    assertTrue(playlist.files[0].played)
    assertEquals(0L, playlist.files[0].leftAtMs)
    assertEquals(playlist, FolderEpisodes.withPlayed(playlist, 0))
    assertEquals(playlist, FolderEpisodes.withPlayed(playlist, 9))
  }

  @Test fun `the log keeps the newest files and reads back what it wrote`() {
    var json: String? = null
    for (n in 1..5) json = FolderEpisodes.appendPlayed(json, PlayedFile("show", "e$n", n.toLong()), max = 3)
    assertEquals(listOf("e3", "e4", "e5"), FolderEpisodes.decodePlayed(json).map { it.fileLocation })
    assertTrue(FolderEpisodes.decodePlayed("{").isEmpty())
    assertTrue(FolderEpisodes.decodePlayed(null).isEmpty())
  }

  @Test fun `one episode from Up Next and its whole book are different loads`() {
    val whole = book(file(1), file(2), file(3))
    val alone = whole.copy(files = whole.files.take(2), alone = true)
    assertTrue(PositionJournal.isSameBook(whole, 3, BookLoad(whole, 0, 0L)))
    assertEquals(false, PositionJournal.isSameBook(alone, 2, BookLoad(whole, 0, 0L)))
    assertEquals(false, PositionJournal.isSameBook(whole, 3, BookLoad(alone, 1, 0L)))
  }

  @Test fun `the marks travel with the book through the journal and the queue`() {
    val load = BookLoad(book(file(1), file(2, played = true), file(3, leftAtMs = 7_000)).copy(alone = true), 0, 0L)
    val back = PositionJournal.decodeLoad(PositionJournal.encodeLoad(load))
    assertEquals(load.playlist, back?.playlist)
    // Older journals have none.
    val old = PositionJournal.decodeLoad(
      """{"bookId":"b","title":"T","author":null,"coverUri":null,"speed":1,"files":[{"uri":"u","location":"l","title":"t","durationMs":1}],"chapters":[],"startIndex":0,"startPositionMs":0,"pausedAt":null}""",
    )
    assertEquals(false, old?.playlist?.skipsPlayed)
    assertEquals(false, old?.playlist?.files?.first()?.played)
  }
}
