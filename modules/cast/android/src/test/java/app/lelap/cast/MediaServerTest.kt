package app.lelap.cast

import org.junit.Assert.assertEquals
import org.junit.Test

class MediaServerTest {
  @Test
  fun parsesRanges() {
    assertEquals(Ranges.Result.Full, Ranges.parse(null, 1000))
    assertEquals(Ranges.Result.Full, Ranges.parse("items=0-1", 1000))
    assertEquals(Ranges.Result.Full, Ranges.parse("bytes=0-1,5-6", 1000))
    assertEquals(Ranges.Result.Partial(0, 999), Ranges.parse("bytes=0-", 1000))
    assertEquals(Ranges.Result.Partial(100, 199), Ranges.parse("bytes=100-199", 1000))
    assertEquals(Ranges.Result.Partial(900, 999), Ranges.parse("bytes=900-5000", 1000))
    assertEquals(Ranges.Result.Partial(800, 999), Ranges.parse("bytes=-200", 1000))
    assertEquals(Ranges.Result.Partial(0, 999), Ranges.parse("bytes=-5000", 1000))
    assertEquals(Ranges.Result.Unsatisfiable, Ranges.parse("bytes=1000-", 1000))
    assertEquals(Ranges.Result.Unsatisfiable, Ranges.parse("bytes=500-100", 1000))
    assertEquals(Ranges.Result.Unsatisfiable, Ranges.parse("bytes=-0", 1000))
  }

  @Test
  fun takesTheTypeFromTheFilesOwnNameWhenTheAddressHasNone() {
    // A Subsonic stream address, and a part downloaded before its name kept the extension.
    assertEquals("Book/03 Part.flac", Mime.nameFor("https://music.example/rest/stream?id=3&t=x", "Book/03 Part.flac"))
    assertEquals("Part.m4b", Mime.nameFor("042.audio", "Part.m4b"))
    // The address's own extension wins; an unknown file name changes nothing.
    assertEquals("https://a.example/p.mp3", Mime.nameFor("https://a.example/p.mp3", "p.flac"))
    assertEquals("https://a.example/stream", Mime.nameFor("https://a.example/stream", "notes.txt"))
    assertEquals("https://a.example/stream", Mime.nameFor("https://a.example/stream", null))
    assertEquals("audio/flac", Mime.audioOr(null, Mime.nameFor("https://music.example/rest/stream", "x.flac")))
  }

  @Test
  fun mapsM4bToATypeReceiversAccept() {
    assertEquals("audio/mp4", Mime.audio("/storage/emulated/0/Books/Dune.m4b"))
    assertEquals("audio/mp4", Mime.audio("Part.M4A"))
    assertEquals("audio/mpeg", Mime.audio("https://archive.org/download/x/part_01.mp3?a=b#t"))
    assertEquals("audio/ogg", Mime.audio("episode.opus"))
    assertEquals("audio/mpeg", Mime.audio("no-extension"))
    assertEquals("audio/mp4", Mime.audioOr("audio/x-m4b", "stream"))
    assertEquals("audio/flac", Mime.audioOr("audio/flac; charset=binary", "stream"))
    assertEquals("audio/mp4", Mime.audioOr("application/octet-stream", "book.m4b"))
    assertEquals("image/png", Mime.image("cover.PNG"))
    assertEquals("m4b", Mime.extension("content://x/document/primary%3ABooks%2FDune.m4b"))
  }
}
