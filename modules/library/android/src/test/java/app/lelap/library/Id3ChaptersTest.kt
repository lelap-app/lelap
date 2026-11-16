package app.lelap.library

import app.lelap.library.Bytes.chap
import app.lelap.library.Bytes.id3
import app.lelap.library.Bytes.tit2
import org.junit.Assert.assertEquals
import org.junit.Test

class Id3ChaptersTest {
  @Test
  fun readsChaptersFromId3v24() {
    val tag = id3(4, tit2(4, "Book"), chap(4, "ch2", 60_000, 120_000, "Kapitel to"), chap(4, "ch1", 0, 60_000, "Kapitel ét"))
    assertEquals(
      listOf(Chapter("Kapitel ét", 0), Chapter("Kapitel to", 60_000)),
      Id3Chapters.parse(tag),
    )
  }

  @Test
  fun readsId3v23FrameSizes() {
    // A 200-byte title makes the v2.3 (plain) and v2.4 (synchsafe) sizes differ.
    val long = "x".repeat(200)
    assertEquals(listOf(Chapter(long, 5)), Id3Chapters.parse(id3(3, chap(3, "a", 5, 10, long))))
  }

  @Test
  fun namesUntitledChaptersByNumber() {
    assertEquals(listOf(Chapter("Chapter 1", 0)), Id3Chapters.parse(id3(4, chap(4, "a", 0, 1, null))))
  }

  @Test
  fun returnsNothingWithoutChapters() {
    assertEquals(emptyList<Chapter>(), Id3Chapters.parse(id3(4, tit2(4, "Book"))))
    assertEquals(emptyList<Chapter>(), Id3Chapters.parse("not a tag".toByteArray()))
  }

  @Test
  fun neverThrowsOnTruncatedInput() {
    val tag = id3(4, chap(4, "a", 0, 1, "One"), chap(4, "b", 2, 3, "Two"))
    for (cut in tag.indices) Id3Chapters.parse(tag.copyOf(cut))
  }

  @Test
  fun tagSizeIncludesTheHeader() {
    assertEquals(10 + 300, Id3Chapters.tagSize(id3(4, ByteArray(300 - 10).let { Bytes.id3Frame(4, "TXXX", it) })))
    assertEquals(0, Id3Chapters.tagSize("abc".toByteArray()))
  }
}
