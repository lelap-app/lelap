package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceQueryTest {
  private fun find(text: String, author: String? = null, kind: VoiceKind? = null) = VoiceRequest.Find(text, author, kind)

  @Test fun `the Assistant's bare title is a title`() {
    assertEquals(find("pride and prejudice"), VoiceQuery.parse("Pride and Prejudice"))
  }

  @Test fun `a whole sentence loses its filler words`() {
    assertEquals(find("pride and prejudice"), VoiceQuery.parse("Hey Google, play Pride and Prejudice on Lelap"))
    assertEquals(find("dune"), VoiceQuery.parse("please listen to Dune in Lelap"))
  }

  @Test fun `nothing, the app's name or my book resumes`() {
    for (q in listOf(null, "", "Lelap", "play Lelap", "resume my book", "continue my audiobook", "play where I left off", "resume", "continue my latest thing")) {
      assertEquals(q, VoiceRequest.Resume, VoiceQuery.parse(q))
    }
  }

  @Test fun `continue with a title is a title`() {
    assertEquals(find("dune"), VoiceQuery.parse("continue Dune"))
  }

  @Test fun `the latest episode of a show`() {
    assertEquals(VoiceRequest.Latest("the garden hour"), VoiceQuery.parse("play the latest episode of The Garden Hour"))
    assertEquals(VoiceRequest.Latest("garden hour"), VoiceQuery.parse("newest episode from Garden Hour podcast"))
    assertEquals(VoiceRequest.Latest("garden hour"), VoiceQuery.parse("the latest Garden Hour episode"))
  }

  @Test fun `audiobook and podcast say which kind`() {
    assertEquals(find("dune", kind = VoiceKind.BOOK), VoiceQuery.parse("play the audiobook Dune"))
    assertEquals(find("dune", kind = VoiceKind.BOOK), VoiceQuery.parse("Dune audiobook"))
    assertEquals(find("the garden hour", kind = VoiceKind.EPISODE), VoiceQuery.parse("the podcast The Garden Hour"))
  }

  @Test fun `titles with book in them keep it`() {
    assertEquals(find("the book thief"), VoiceQuery.parse("play The Book Thief"))
    assertEquals(find("the jungle book"), VoiceQuery.parse("The Jungle Book"))
  }

  @Test fun `by names the author`() {
    assertEquals(find("dune by frank herbert", "frank herbert"), VoiceQuery.parse("Dune by Frank Herbert"))
  }

  @Test fun `the Assistant's own title and artist win`() {
    assertEquals(find("emma", "jane austen"), VoiceQuery.parse("emma jane austen", title = "Emma", artist = "Jane Austen"))
  }

  @Test fun `accents, case and punctuation don't matter`() {
    assertEquals("les miserables", VoiceText.normalize("Les Misérables!"))
    assertEquals("the hitchhikers guide", VoiceText.normalize("The Hitchhiker’s Guide"))
    assertEquals(listOf("hobbit"), VoiceText.words("The Hobbit"))
  }
}
