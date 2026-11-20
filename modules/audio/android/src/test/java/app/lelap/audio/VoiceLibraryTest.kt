package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceLibraryTest {
  private fun load(id: String, title: String, author: String? = null, pausedAt: Long? = 100, handsOver: Boolean = false) = BookLoad(
    BookPlaylist(id, title, author, null, listOf(BookFile("https://x/$id.mp3", "loc-$id", "Part 1", 1000)), emptyList(), 1f),
    startIndex = 0,
    startPositionMs = 250,
    pausedAt = pausedAt,
    handsOver = handsOver,
  )

  private val snapshot = CarSnapshot(
    continueListening = listOf(load("dune", "Dune", "Frank Herbert")),
    podcasts = listOf(load("ep", "Planting garlic", "The Garden Hour", handsOver = true)),
    library = listOf(load("pp", "Pride and Prejudice", "Jane Austen"), load("talk", "Dune at sixty", "Book Talk")),
    lists = listOf(CarList("l", "Trip", false, null, null, listOf(load("emma", "Emma", "Jane Austen", handsOver = true)))),
    episodes = setOf("talk"),
    searchCatalogs = listOf(SearchCatalog("https://a.example.org/", "audiobook", "s", "A")),
  )

  @Test fun `a book beyond the shelves is found and plays from its place`() {
    val answer = VoiceLibrary.answer("Pride and Prejudice", null, null, snapshot, null)
    assertEquals("search/pp", answer.local.first().candidate.id)
    assertFalse(answer.askAddons)
    val load = VoiceLibrary.resolve("search/pp", snapshot, null)!!
    assertEquals(250L, load.startPositionMs)
  }

  @Test fun `episodes are known as episodes, books first`() {
    val ids = VoiceLibrary.answer("dune", null, null, snapshot, null).local.map { it.candidate.id }
    assertEquals(listOf("search/dune", "search/talk"), ids)
  }

  @Test fun `resume plays the journal's book, else Continue listening's first`() {
    val journal = load("emma", "Emma", "Jane Austen", pausedAt = 500)
    assertEquals("search/emma", VoiceLibrary.answer("resume my book", null, null, snapshot, journal).local.single().candidate.id)
    assertEquals("search/dune", VoiceLibrary.answer("", null, null, snapshot, null).local.single().candidate.id)
    assertTrue(VoiceLibrary.answer("", null, null, CarSnapshot(), null).local.isEmpty())
  }

  @Test fun `the latest episode of a followed show`() {
    val answer = VoiceLibrary.answer("latest episode of the garden hour", null, null, snapshot, null)
    assertEquals("search/ep", answer.local.single().candidate.id)
    assertFalse(answer.askAddons)
  }

  @Test fun `the latest episode beats an older one half played`() {
    val older = snapshot.copy(library = snapshot.library + load("old", "Pruning roses", "The Garden Hour", pausedAt = 9_999), episodes = setOf("talk", "old"))
    assertEquals("search/ep", VoiceLibrary.answer("newest episode of the garden hour", null, null, older, null).local.first().candidate.id)
  }

  @Test fun `no clear match asks the add-ons`() {
    assertTrue(VoiceLibrary.answer("persuasion", null, null, snapshot, null).askAddons)
    assertTrue(VoiceLibrary.answer("jane austen", null, null, snapshot, null).askAddons)
  }

  @Test fun `a list's book plays on its own, the journal's place when newer`() {
    assertFalse(VoiceLibrary.resolve("search/emma", snapshot, null)!!.handsOver)
    val journal = load("dune", "Dune", "Frank Herbert", pausedAt = 900).copy(startPositionMs = 777)
    assertEquals(777L, VoiceLibrary.resolve("search/dune", snapshot, journal)!!.startPositionMs)
    assertNull(VoiceLibrary.resolve("phone/dune", snapshot, null))
  }

  @Test fun `the snapshot keeps the voice fields through its encoding`() {
    val back = CarLibrary.decode(CarLibrary.encode(snapshot))
    assertEquals(listOf("pp", "talk"), back.library.map { it.playlist.bookId })
    assertEquals(setOf("talk"), back.episodes)
    assertEquals(snapshot.searchCatalogs, back.searchCatalogs)
  }
}
