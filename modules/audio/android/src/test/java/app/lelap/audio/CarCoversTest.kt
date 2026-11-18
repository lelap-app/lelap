package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CarCoversTest {
  private fun load(id: String, cover: String?) = BookLoad(
    BookPlaylist(id, "Title $id", null, cover, listOf(BookFile("https://x/$id.mp3", "loc-$id", "Part", 1000)), emptyList(), 1f),
    startIndex = 0,
    startPositionMs = 0,
  )

  private val file = "file:///data/user/0/app.lelap/files/covers/a.jpg"
  private val picked = "content://com.android.externalstorage.documents/tree/x/document/b%2Fcover.jpg"

  @Test fun `web covers stay as they are and local ones get a provider address`() {
    assertEquals("https://img/a.jpg", CarCovers.artworkUri("https://img/a.jpg", "app.lelap.covers"))
    val address = CarCovers.artworkUri(file, "app.lelap.covers")!!
    assertTrue(address.startsWith("content://app.lelap.covers/"))
    // The path itself never reaches the car.
    assertTrue("covers/a.jpg" !in address)
    assertNull(CarCovers.artworkUri(file, null))
    assertNull(CarCovers.artworkUri(null, "app.lelap.covers"))
    assertNull(CarCovers.artworkUri("opfs:x", "app.lelap.covers"))
  }

  @Test fun `only covers of books the car lists are found`() {
    val snapshot = CarSnapshot(onPhone = listOf(load("a", file)), upNext = listOf(load("b", picked)))
    assertEquals(file, CarCovers.find(CarCovers.key(file), snapshot, null))
    assertEquals(picked, CarCovers.find(CarCovers.key(picked), snapshot, null))
    assertNull(CarCovers.find(CarCovers.key("file:///data/user/0/app.lelap/databases/lelap.db"), snapshot, null))
    assertNull(CarCovers.find("not-a-key", snapshot, null))
  }

  @Test fun `only image files and other apps' documents are served`() {
    assertTrue(CarCovers.servableFile("a.jpg"))
    assertTrue(CarCovers.servableFile("Cover.PNG"))
    assertTrue(CarCovers.servableFile("folder-1a2b.webp"))
    // Names of the files the provider would really open, after `#`, `%2e` and links.
    assertFalse(CarCovers.servableFile("lelap.db"))
    assertFalse(CarCovers.servableFile("audio.xml"))
    assertFalse(CarCovers.servableFile("lelap.db#.jpg".substringBefore('#')))
    assertTrue(CarCovers.servableDocument(picked, "app.lelap"))
    assertFalse(CarCovers.servableDocument("content://app.lelap.fileprovider/cache/shared/x.jpg", "app.lelap"))
    assertFalse(CarCovers.servableDocument("content://app.lelap/x.jpg", "app.lelap"))
    assertFalse(CarCovers.servableDocument("content:///x.jpg", "app.lelap"))
  }

  @Test fun `the journal's book counts, since it leads Continue listening`() {
    val journal = load("c", "file:///c.jpg").playlist
    assertEquals("file:///c.jpg", CarCovers.find(CarCovers.key("file:///c.jpg"), CarSnapshot(), journal))
  }

  @Test fun `the type follows the extension`() {
    assertEquals("image/png", CarCovers.mimeType("file:///c/a.PNG"))
    assertEquals("image/jpeg", CarCovers.mimeType("file:///c/a"))
    assertEquals("image/jpeg", CarCovers.mimeType(null))
  }

  @Test fun `a web cover is never served by the provider`() {
    val snapshot = CarSnapshot(onPhone = listOf(load("a", "https://img/a.jpg")))
    assertNull(CarCovers.find(CarCovers.key("https://img/a.jpg"), snapshot, null))
  }
}
