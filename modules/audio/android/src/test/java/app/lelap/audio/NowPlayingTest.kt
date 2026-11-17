package app.lelap.audio

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class NowPlayingTest {
  @Test fun encodesTheKeysTheWidgetReads() {
    val json = JSONObject(
      NowPlaying("b1", "Moby Dick", "Chapter 1", "Melville", "https://covers.example/1.jpg", true, 30_000L).encode(),
    )
    assertEquals("b1", json.getString("bookId"))
    assertEquals("Moby Dick", json.getString("title"))
    assertEquals("Chapter 1", json.getString("chapter"))
    assertEquals("Melville", json.getString("author"))
    assertEquals("https://covers.example/1.jpg", json.getString("coverUri"))
    assertEquals(true, json.getBoolean("playing"))
    assertEquals(30_000L, json.getLong("skipMs"))
  }

  @Test fun leavesOutMissingFields() {
    val json = JSONObject(NowPlaying("b1", "Moby Dick", null, null, null, false, 15_000L).encode())
    assertFalse(json.has("chapter"))
    assertFalse(json.has("coverUri"))
  }
}
