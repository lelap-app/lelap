package app.lelap.widget

import app.lelap.text.NativeCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {
  // What modules/audio's NowPlaying.encode() writes (see NowPlayingTest there).
  private val saved = """{"bookId":"b1","title":"Moby Dick","chapter":"Chapter 1","author":"Melville",""" +
    """"coverUri":"https://covers.example/1.jpg","playing":true,"skipMs":15000}"""

  @Test fun decodesWhatThePlaybackServiceSaves() {
    val now = NowPlayingSnapshot.decode(saved)!!
    assertEquals("b1", now.bookId)
    assertEquals("Moby Dick", now.title)
    assertEquals("Chapter 1", now.chapter)
    assertEquals("Melville", now.author)
    assertEquals("https://covers.example/1.jpg", now.coverUri)
    assertTrue(now.playing)
    assertEquals(15_000L, now.skipMs)
  }

  @Test fun nothingLoadedOrUnreadableIsNull() {
    assertNull(NowPlayingSnapshot.decode(null))
    assertNull(NowPlayingSnapshot.decode("{}"))
    assertNull(NowPlayingSnapshot.decode("not json"))
  }

  @Test fun missingFieldsFallBack() {
    val now = NowPlayingSnapshot.decode("""{"bookId":"b1","title":"T"}""")!!
    assertNull(now.chapter)
    assertNull(now.coverUri)
    assertFalse(now.playing)
    assertEquals(NowPlayingSnapshot.DEFAULT_SKIP_MS, now.skipMs)
  }

  @Test fun widgetShowsChapterThenAuthor() {
    val model = Models.widget(NowPlayingSnapshot.decode(saved))
    assertTrue(model.hasBook)
    assertEquals("Moby Dick", model.title)
    assertEquals("Chapter 1", model.subtitle)
    assertEquals("Melville", model.detail)
    assertTrue(model.playing)
    assertEquals("Pause", model.playLabel)
    assertEquals(15L, model.skipSeconds)
    assertEquals("Back 15 seconds", model.backLabel)
    assertEquals("Forward 15 seconds", model.forwardLabel)
    assertEquals("Moby Dick, Chapter 1. Opens the player.", model.openLabel)
  }

  @Test fun widgetWithoutChapterShowsTheAuthorOnce() {
    val model = Models.widget(NowPlayingSnapshot.decode("""{"bookId":"b1","title":"T","author":"A","playing":false}"""))
    assertEquals("A", model.subtitle)
    assertNull(model.detail)
    assertEquals("Play", model.playLabel)
  }

  @Test fun widgetWithNothingPlaying() {
    val model = Models.widget(null)
    assertFalse(model.hasBook)
    assertEquals("Nothing playing", model.title)
    assertFalse(model.playing)
    assertEquals(30L, model.skipSeconds)
    assertEquals("Nothing playing, Open Lelap to pick a book. Opens the player.", model.openLabel)
  }

  @Test fun tallFromTwoRows() {
    assertFalse(Models.isTall(40))
    assertFalse(Models.isTall(99))
    assertTrue(Models.isTall(110))
  }

  @Test fun tileFollowsPlayback() {
    val playing = NowPlayingSnapshot.decode(saved)
    assertEquals(TileModel(TileState.ACTIVE, "Moby Dick", "Playing"), Models.tile(playing))
    assertEquals(TileModel(TileState.INACTIVE, "Moby Dick", "Paused"), Models.tile(playing!!.copy(playing = false)))
    assertEquals(TileModel(TileState.INACTIVE, "Lelap", "Not playing"), Models.tile(null))
  }

  @Test fun followsTheProfilesLanguage() {
    val ms = NativeCatalog(
      "ms",
      mapOf(
        "Nothing playing" to "Tiada yang dimainkan",
        "Open Lelap to pick a book" to "Buka Lelap untuk memilih buku",
        "Pause" to "Jeda",
        "Back {n} seconds" to "Undur {n} saat",
        "{what}. Opens the player." to "{what}. Membuka pemain.",
        "Playing" to "Sedang dimainkan",
      ),
    )
    val empty = Models.widget(null, ms)
    assertEquals("Tiada yang dimainkan", empty.title)
    assertEquals("Tiada yang dimainkan, Buka Lelap untuk memilih buku. Membuka pemain.", empty.openLabel)
    val playing = Models.widget(NowPlayingSnapshot.decode(saved), ms)
    // The book's own title and chapter are not translated; a missing line stays English.
    assertEquals("Moby Dick", playing.title)
    assertEquals("Chapter 1", playing.subtitle)
    assertEquals("Jeda", playing.playLabel)
    assertEquals("Undur 15 saat", playing.backLabel)
    assertEquals("Forward 15 seconds", playing.forwardLabel)
    assertEquals(TileModel(TileState.ACTIVE, "Moby Dick", "Sedang dimainkan"), Models.tile(NowPlayingSnapshot.decode(saved), ms))
  }

  @Test fun coverSampling() {
    assertEquals(1, Models.sampleSize(300, 300, 320))
    assertEquals(1, Models.sampleSize(600, 600, 320))
    assertEquals(2, Models.sampleSize(640, 640, 320))
    assertEquals(4, Models.sampleSize(1400, 1000, 320))
  }

  @Test fun theTallWidgetSaysWhatComesNextInTheList() {
    val next = Models.widget(NowPlayingSnapshot.decode("""{"bookId":"b1","title":"T","chapter":"C","author":"A","list":"Road trip","listNext":"Emma"}"""))
    assertEquals("Next in list: Emma", next.detail)
    assertEquals("C", next.subtitle)
    val last = Models.widget(NowPlayingSnapshot.decode("""{"bookId":"b1","title":"T","list":"Road trip"}"""))
    assertEquals("From the list “Road trip”", last.detail)
  }
}
