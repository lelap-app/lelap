package app.lelap.audio

import androidx.media3.common.Metadata
import androidx.media3.common.MimeTypes
import androidx.media3.extractor.metadata.icy.IcyInfo
import androidx.media3.extractor.metadata.id3.TextInformationFrame
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LiveStreamTest {
  @Test
  fun icyTitleIsTheLine() {
    val icy = IcyInfo(ByteArray(0), "  Nina Simone -  Feeling Good ", null)
    assertEquals("Nina Simone - Feeling Good", LiveStream.lineOf(Metadata(icy)))
  }

  @Test
  fun id3FramesMakeArtistAndTitle() {
    val title = TextInformationFrame("TIT2", null, listOf("Feeling Good"))
    val artist = TextInformationFrame("TPE1", null, listOf("Nina Simone"))
    assertEquals("Nina Simone - Feeling Good", LiveStream.lineOf(Metadata(title, artist)))
    assertEquals("The World Tonight", LiveStream.lineOf(Metadata(TextInformationFrame("TIT2", null, listOf("The World Tonight")))))
  }

  @Test
  fun anEmptyUpdateSaysNothing() {
    assertNull(LiveStream.lineOf(Metadata(IcyInfo(ByteArray(0), "", null))))
    assertNull(LiveStream.line("-", null, null))
  }

  @Test
  fun hlsByMimeOrAddress() {
    assertEquals(MimeTypes.APPLICATION_M3U8, LiveStream.mimeFor("https://x.example/live", "application/x-mpegURL"))
    assertNull(LiveStream.mimeFor("https://x.example/live.m3u8", "audio/mpeg"))
    assertEquals(MimeTypes.APPLICATION_M3U8, LiveStream.mimeFor("https://x.example/live.m3u8?token=1", null))
    assertNull(LiveStream.mimeFor("https://x.example/stream.mp3", null))
  }
}
