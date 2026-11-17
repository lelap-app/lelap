package app.lelap.widget

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

  @Test fun coverSampling() {
    assertEquals(1, Models.sampleSize(300, 300, 320))
    assertEquals(1, Models.sampleSize(600, 600, 320))
    assertEquals(2, Models.sampleSize(640, 640, 320))
    assertEquals(4, Models.sampleSize(1400, 1000, 320))
  }
}
