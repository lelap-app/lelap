package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceSearchTest {
  private fun book(id: String, title: String, author: String? = null, pausedAt: Long? = null) =
    VoiceCandidate("search/$id", title, author, VoiceKind.BOOK, local = true, pausedAt = pausedAt)
  private fun episode(id: String, title: String, show: String) =
    VoiceCandidate("search/$id", title, show, VoiceKind.EPISODE, local = true)
  private fun addon(id: String, title: String, author: String? = null) =
    VoiceCandidate("addon:audiobook/$id", title, author, VoiceKind.BOOK, local = false)

  private val library = listOf(
    book("pp", "Pride and Prejudice", "Jane Austen"),
    book("emma", "Emma", "Jane Austen"),
    book("dune", "Dune", "Frank Herbert"),
    book("messiah", "Dune Messiah", "Frank Herbert"),
    book("hhg", "The Hitchhiker's Guide to the Galaxy", "Douglas Adams"),
    episode("ep1", "Dune, fifty years on", "Book Talk"),
    episode("ep2", "Planting garlic", "The Garden Hour"),
  )

  private fun rank(query: String) = VoiceSearch.rank(VoiceQuery.parse(query) as VoiceRequest.Find, library)

  @Test fun `a whole title is a clear match`() {
    val matches = rank("pride and prejudice")
    assertEquals("search/pp", matches.first().candidate.id)
    assertEquals(100, matches.first().score)
    assertTrue(VoiceSearch.isClear(matches))
  }

  @Test fun `the exact title beats its sequel, and the book beats an episode about it`() {
    val matches = rank("dune")
    assertEquals(listOf("search/dune", "search/messiah", "search/ep1"), matches.map { it.candidate.id })
    assertTrue(VoiceSearch.isClear(matches))
  }

  @Test fun `a title said in part still finds it`() {
    val matches = rank("hitchhiker's guide")
    assertEquals("search/hhg", matches.first().candidate.id)
  }

  @Test fun `an author alone matches each of theirs, none clearly`() {
    val matches = rank("jane austen")
    assertEquals(setOf("search/pp", "search/emma"), matches.map { it.candidate.id }.toSet())
    assertFalse(VoiceSearch.isClear(matches))
  }

  @Test fun `title and author in one breath`() {
    assertEquals("search/emma", rank("emma jane austen").first().candidate.id)
    assertEquals("search/emma", rank("emma by jane austen").first().candidate.id)
  }

  @Test fun `the wrong author counts against a title`() {
    val right = rank("dune by frank herbert").first()
    val wrong = rank("dune by someone else").first()
    assertTrue(right.score > wrong.score)
  }

  @Test fun `unrelated words match nothing`() {
    assertTrue(rank("war and peace").isEmpty())
  }

  @Test fun `asking for a podcast puts episodes first`() {
    val matches = VoiceSearch.rank(VoiceRequest.Find("dune", kind = VoiceKind.EPISODE), library)
    assertEquals("search/ep1", matches.first().candidate.id)
  }

  @Test fun `the latest episode is found by its show`() {
    val matches = VoiceSearch.latest(VoiceRequest.Latest("garden hour"), library)
    assertEquals(listOf("search/ep2"), matches.map { it.candidate.id })
  }

  @Test fun `among equal matches the one played last wins`() {
    val two = listOf(book("a", "Emma", "Jane Austen", pausedAt = 10), book("b", "Emma", "Jane Austen", pausedAt = 20))
    val matches = VoiceSearch.rank(VoiceRequest.Find("emma"), two)
    assertEquals("search/b", matches.first().candidate.id)
    assertFalse(VoiceSearch.isClear(matches))
  }

  @Test fun `a clear match on the phone plays before any add-on`() {
    val local = rank("dune")
    val addons = VoiceSearch.rank(VoiceRequest.Find("dune"), listOf(addon("x", "Dune")))
    assertEquals("search/dune", VoiceSearch.choose(local, addons)?.candidate?.id)
  }

  @Test fun `with no clear match on the phone a better add-on match plays`() {
    val local = rank("persuasion")
    val addons = VoiceSearch.rank(VoiceRequest.Find("persuasion"), listOf(addon("p", "Persuasion", "Jane Austen")))
    assertEquals("addon:audiobook/p", VoiceSearch.choose(local, addons)?.candidate?.id)
    assertNull(VoiceSearch.choose(emptyList(), emptyList()))
  }

  @Test fun `results list the phone first and leave out add-on copies of its books`() {
    val local = rank("dune")
    val addons = VoiceSearch.rank(VoiceRequest.Find("dune"), listOf(addon("x", "Dune", "Frank Herbert"), addon("y", "Dune Road")))
    val merged = VoiceSearch.merge(local, addons)
    assertEquals(listOf("search/dune", "search/messiah", "search/ep1", "addon:audiobook/y"), merged.map { it.candidate.id })
  }
}
