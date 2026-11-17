package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CarLibraryTest {
  private fun load(id: String, pausedAt: Long? = 100, cover: String? = "https://img/$id.jpg", handsOver: Boolean = false) = BookLoad(
    BookPlaylist(
      id,
      "Title $id",
      "Author $id",
      cover,
      listOf(BookFile("https://x/$id/1.mp3", "loc-$id-1", "Part 1", 1000), BookFile("https://x/$id/2.mp3", "loc-$id-2", "Part 2", 1000)),
      emptyList(),
      1f,
    ),
    startIndex = 0,
    startPositionMs = 250,
    pausedAt = pausedAt,
    handsOver = handsOver,
  )

  private val snapshot = CarSnapshot(
    continueListening = listOf(load("a"), load("b")),
    onPhone = listOf(load("b")),
    podcasts = listOf(load("ep", handsOver = true)),
    upNext = listOf(load("c")),
  )

  @Test fun `the root offers four browsable shelves`() {
    val shelves = CarLibrary.children(CarLibrary.ROOT, snapshot, null)!!
    assertEquals(listOf("continue", "phone", "podcasts", "upnext"), shelves.map { it.id })
    assertEquals("Continue listening", shelves[0].title)
    assertTrue(shelves.all { it.browsable && !it.playable })
  }

  @Test fun `shelves list playable books with their shelf in the id`() {
    val phone = CarLibrary.children(CarLibrary.ON_PHONE, snapshot, null)!!
    assertEquals(listOf("phone/b"), phone.map { it.id })
    assertEquals("Title b", phone[0].title)
    assertEquals("Author b", phone[0].subtitle)
    assertTrue(phone[0].playable && !phone[0].browsable)
    assertNull(CarLibrary.children("nowhere", snapshot, null))
  }

  @Test fun `the journal's book leads Continue listening without a duplicate`() {
    val journal = load("b", pausedAt = 500)
    val ids = CarLibrary.children(CarLibrary.CONTINUE, snapshot, journal)!!.map { it.id }
    assertEquals(listOf("continue/b", "continue/a"), ids)
  }

  @Test fun `covers the car cannot open are left out`() {
    val local = CarSnapshot(onPhone = listOf(load("x", cover = "file:///data/cover.jpg")))
    assertNull(CarLibrary.children(CarLibrary.ON_PHONE, local, null)!![0].artworkUri)
    assertEquals("https://img/b.jpg", CarLibrary.item("phone/b", snapshot, null)?.artworkUri)
  }

  @Test fun `items are found by id`() {
    assertEquals("podcasts", CarLibrary.item("podcasts", snapshot, null)?.id)
    assertEquals("upnext/c", CarLibrary.item("upnext/c", snapshot, null)?.id)
    assertNull(CarLibrary.item("upnext/a", snapshot, null))
    assertNull(CarLibrary.item("upnext/", snapshot, null))
  }

  @Test fun `resolve picks the newer of the journal's place and the app's`() {
    val newer = load("a", pausedAt = 900).copy(startIndex = 1, startPositionMs = 42)
    val picked = CarLibrary.resolve("continue/a", snapshot, newer)!!
    assertEquals(1, picked.startIndex)
    assertEquals(42L, picked.startPositionMs)
    val older = load("a", pausedAt = 10).copy(startPositionMs = 7)
    assertEquals(250L, CarLibrary.resolve("continue/a", snapshot, older)!!.startPositionMs)
  }

  @Test fun `an episode keeps handing over when resolved from the journal`() {
    val journal = load("ep", pausedAt = 900)
    assertTrue(CarLibrary.resolve("podcasts/ep", snapshot, journal)!!.handsOver)
  }

  @Test fun `file locations from other controllers are not car items`() {
    assertNull(CarLibrary.resolve("loc-a-1", snapshot, null))
    assertNull(CarLibrary.resolve("folder/a", snapshot, null))
    assertNull(CarLibrary.resolve("continue/zzz", snapshot, null))
  }

  @Test fun `the journal becomes a load at its file and place`() {
    val playlist = load("a").playlist
    val loaded = CarLibrary.journalLoad(JournalEntry("a", "loc-a-2", 300, 77), playlist)!!
    assertEquals(1, loaded.startIndex)
    assertEquals(300L, loaded.startPositionMs)
    assertEquals(77L, loaded.pausedAt)
    assertFalse(loaded.handsOver)
    assertNull(CarLibrary.journalLoad(JournalEntry("a", "gone", 300, 77), playlist))
  }

  @Test fun `the snapshot survives its own encoding`() {
    assertEquals(snapshot, CarLibrary.decode(CarLibrary.encode(snapshot)))
    assertEquals(CarSnapshot(), CarLibrary.decode("not json"))
    assertEquals(CarSnapshot(), CarLibrary.decode(null))
  }

  @Test fun `earlier places keep one entry per book, newest last, capped`() {
    var json: String? = null
    json = PositionJournal.appendEarlier(json, JournalEntry("a", "loc", 1, 1))
    json = PositionJournal.appendEarlier(json, JournalEntry("b", "loc", 2, 2))
    json = PositionJournal.appendEarlier(json, JournalEntry("a", "loc", 3, 3))
    assertEquals(listOf("b", "a"), PositionJournal.decodeEntries(json).map { it.bookId })
    assertEquals(3L, PositionJournal.decodeEntries(json).last().filePositionMs)
    val capped = PositionJournal.appendEarlier(json, JournalEntry("c", "loc", 4, 4), max = 2)
    assertEquals(listOf("a", "c"), PositionJournal.decodeEntries(capped).map { it.bookId })
    assertTrue(PositionJournal.decodeEntries("[").isEmpty())
  }
}
