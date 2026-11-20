package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EpisodeFilesTest {
  private val auto = AutoFile("https://cdn.example/gh42.mp3", "https://cdn.example/gh42-small.aac")
  private val streamed = BookFile(auto.unmetered, "episode:p:42", "Why tomatoes split", 3_600_000, auto = auto)

  @Test fun `streams the smallest file on mobile data and the feed's own otherwise`() {
    assertEquals(auto.metered, EpisodeFiles.uriFor(streamed, mobileData = true))
    assertEquals(auto.unmetered, EpisodeFiles.uriFor(streamed, mobileData = false))
    // Sent while the phone was on mobile data, started later on Wi-Fi.
    assertEquals(auto.unmetered, EpisodeFiles.uriFor(streamed.copy(uri = auto.metered), mobileData = false))
  }

  @Test fun `a file without the pair, or downloaded since, plays as sent`() {
    assertEquals(auto.unmetered, EpisodeFiles.uriFor(streamed.copy(auto = null), mobileData = true))
    val downloaded = streamed.copy(uri = "file:///downloads/ep/gh42.mp3")
    assertEquals(downloaded.uri, EpisodeFiles.uriFor(downloaded, mobileData = true))
  }

  @Test fun `the app's pick of the loaded file is no new file`() {
    val loaded = BookPlaylist("ep", "T", null, null, listOf(streamed), emptyList(), 1f)
    // Loaded with the feed's own address, playing the small file on mobile data; the app picks it too.
    val picked = loaded.copy(files = listOf(streamed.copy(uri = auto.metered)))
    assertFalse(PositionJournal.filesChanged(loaded, picked, mobileData = true))
    assertFalse(PositionJournal.filesChanged(picked, loaded, mobileData = false))
    val downloaded = loaded.copy(files = listOf(streamed.copy(uri = "file:///downloads/ep/gh42.mp3")))
    assertTrue(PositionJournal.filesChanged(loaded, downloaded, mobileData = true))
  }

  @Test fun `the pair survives the journal and the queue`() {
    val pair = ""","auto":{"unmetered":"${auto.unmetered}","metered":"${auto.metered}"}"""
    val json = """
      {"bookId":"ep","title":"T","author":null,"coverUri":null,"speed":1,
       "files":[{"uri":"${auto.unmetered}","location":"episode:p:42","title":"x","durationMs":5$pair}],
       "chapters":[],"startIndex":0,"startPositionMs":0}
    """.trimIndent()
    val load = PositionJournal.decodeLoad(json)!!
    assertEquals(auto, load.playlist.files[0].auto)
    assertEquals(load, PositionJournal.decodeLoad(PositionJournal.encodeLoad(load)))
    assertNull(PositionJournal.decodeLoad(json.replace(pair, ""))!!.playlist.files[0].auto)
  }
}
