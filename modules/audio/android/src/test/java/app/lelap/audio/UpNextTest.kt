package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpNextTest {
  private fun load(id: String, handsOver: Boolean) = BookLoad(
    BookPlaylist(id, "Title $id", null, null, listOf(BookFile("https://x/$id.mp3", "loc-$id", "Part", 1000)), emptyList(), 1f),
    startIndex = 0,
    startPositionMs = 250,
    pausedAt = 99,
    handsOver = handsOver,
  )

  @Test fun `an episode hands over to the first queued item, a book does not`() {
    val queue = listOf(load("b", true), load("c", false))
    val (next, rest) = UpNext.afterEnd(handsOver = true, queue)
    assertEquals("b", next?.playlist?.bookId)
    assertEquals(listOf("c"), rest.map { it.playlist.bookId })
    val (none, same) = UpNext.afterEnd(handsOver = false, queue)
    assertNull(none)
    assertEquals(queue, same)
    assertNull(UpNext.afterEnd(handsOver = true, emptyList()).first)
  }

  @Test fun `the queue survives its own encoding`() {
    val queue = listOf(load("b", true), load("c", false))
    val json = "[" + queue.joinToString(",") { PositionJournal.encodeLoad(it) } + "]"
    assertEquals(queue, UpNext.decodeQueue(json))
    assertTrue(UpNext.decodeQueue("not json").isEmpty())
    assertTrue(UpNext.decodeQueue(null).isEmpty())
  }

  @Test fun `the finished log round-trips`() {
    val log = listOf(Finished("a", 1), Finished("b", 2, "b/0.mp3", 61_000))
    assertEquals(log, UpNext.decodeFinished(UpNext.encodeFinished(log)))
    assertTrue(UpNext.decodeFinished("{").isEmpty())
    // A log written before M102 has no session start.
    assertEquals(listOf(Finished("c", 3)), UpNext.decodeFinished("""[{"bookId":"c","at":3}]"""))
  }
}
