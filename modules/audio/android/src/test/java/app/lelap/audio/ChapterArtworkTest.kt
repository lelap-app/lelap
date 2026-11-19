package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class ChapterArtworkTest {
  private val episode = BookPlaylist(
    bookId = "ep-1",
    title = "Why tomatoes split",
    author = "Garden Hour",
    coverUri = "file:///covers/show.jpg",
    files = listOf(BookFile("https://cdn.example/gh42.mp3", "episode:p:42", "Why tomatoes split", 3_600_000)),
    chapters = emptyList(),
    speed = 1f,
    artworks = listOf(
      ArtworkMark(60_000, "https://img.example/tomato.jpg"),
      ArtworkMark(600_000, null),
      ArtworkMark(900_000, "https://img.example/leek.jpg"),
    ),
  )

  @Test fun `shows the cover until the first picture, then each in turn`() {
    assertEquals("file:///covers/show.jpg", ChapterArtwork.at(episode, 0, 59_999))
    assertEquals("https://img.example/tomato.jpg", ChapterArtwork.at(episode, 0, 60_000))
    assertEquals("https://img.example/leek.jpg", ChapterArtwork.at(episode, 0, 1_000_000))
  }

  @Test fun `a mark without a picture goes back to the cover`() {
    assertEquals("file:///covers/show.jpg", ChapterArtwork.at(episode, 0, 700_000))
  }

  @Test fun `counts on the whole-book timeline and keeps the cover without pictures`() {
    val twoParts = episode.copy(
      files = listOf(BookFile("a", "a", "A", 50_000), BookFile("b", "b", "B", 3_550_000)),
    )
    assertEquals("https://img.example/tomato.jpg", ChapterArtwork.at(twoParts, 1, 10_000))
    assertEquals("file:///covers/show.jpg", ChapterArtwork.at(episode.copy(artworks = emptyList()), 0, 700_000))
  }

  @Test fun `the pictures survive the journal`() {
    val decoded = PositionJournal.decodeLoad(PositionJournal.encodeLoad(BookLoad(episode, 0, 0L)))
    assertEquals(episode.artworks, decoded?.playlist?.artworks)
  }
}
