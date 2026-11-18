package app.lelap.library

import app.lelap.library.Bytes.chapBody
import app.lelap.library.Bytes.id3
import app.lelap.library.Bytes.id3Frame
import app.lelap.library.Bytes.id3FramePlain
import app.lelap.library.Bytes.id3FrameUnsync
import app.lelap.library.Bytes.id3Unsynced
import app.lelap.library.Bytes.id3v22Frame
import app.lelap.library.Bytes.textBody
import app.lelap.library.Bytes.tit2
import app.lelap.library.Bytes.txxxBody
import app.lelap.library.Bytes.unsync
import org.junit.Assert.assertEquals
import org.junit.Test

/** Unsynchronisation, odd v2.4 frame sizes and v2.2, for both readers of ID3 frames. */
class Id3FramesTest {
  private val isbn = "9780000000002"

  // UTF-16 text starts with a byte order mark holding 0xFF, and 65,280 ms is 00 00 FF 00.
  private val start = 0xff00L
  private val txxx = txxxBody("ISBN", isbn, encoding = 1)

  @Test
  fun readsAWholeTagUnsynchronisedInV23() {
    val tag = id3Unsynced(3, id3Frame(3, "TXXX", txxx), id3Frame(3, "CHAP", chapBody("c1", start, start + 1, tit2(3, "Ét"))))
    assertEquals(mapOf("ISBN" to isbn), IdTags.parse("book.mp3", tag))
    assertEquals(listOf(Chapter("Ét", start)), Id3Chapters.parse(tag))
  }

  @Test
  fun readsFramesUnsynchronisedOneByOneInV24() {
    val chap = chapBody("c1", start, start + 1, tit2(4, "Ét"))
    val perFrame = id3(4, id3FrameUnsync("TXXX", txxx), id3FrameUnsync("CHAP", chap))
    assertEquals(mapOf("ISBN" to isbn), IdTags.parse("book.mp3", perFrame))
    assertEquals(listOf(Chapter("Ét", start)), Id3Chapters.parse(perFrame))

    // The header flag alone says every frame is unsynchronised.
    val wholeTag = id3(4, id3Frame(4, "TXXX", unsync(txxx)), id3Frame(4, "CHAP", unsync(chap)), flags = 0x80)
    assertEquals(mapOf("ISBN" to isbn), IdTags.parse("book.mp3", wholeTag))
    assertEquals(listOf(Chapter("Ét", start)), Id3Chapters.parse(wholeTag))
  }

  @Test
  fun readsV24FrameSizesWrittenAsPlainNumbers() {
    // 300 is 00 00 01 2C, which read as synchsafe is 172; 200 is 00 00 00 C8, never synchsafe.
    val notes = txxxBody("Notes", "x".repeat(300 - 7))
    val comment = txxxBody("Comment", "x".repeat(200 - 9))
    val title = "y".repeat(299)
    val chap = chapBody("c1", 5, 6, id3FramePlain("TIT2", textBody(title)))
    val tag = id3(
      4,
      id3FramePlain("TXXX", notes),
      id3FramePlain("TXXX", comment),
      id3FramePlain("TXXX", txxxBody("ISBN", isbn)),
      id3FramePlain("CHAP", chap),
    )
    assertEquals(300, notes.size)
    assertEquals(200, comment.size)
    assertEquals(mapOf("ISBN" to isbn), IdTags.parse("book.mp3", tag))
    assertEquals(listOf(Chapter(title, 5)), Id3Chapters.parse(tag))
  }

  @Test
  fun readsV22() {
    val tag = id3(
      2,
      id3v22Frame("TT2", textBody("Book")),
      id3v22Frame("TXX", txxxBody("ASIN", "B002UZMLXM")),
      id3v22Frame("TRC", textBody("XX0AB2400001")),
    )
    val tags = IdTags.parseAll("book.mp3", tag)
    assertEquals(mapOf("ASIN" to "B002UZMLXM"), tags.ids)
    assertEquals("XX0AB2400001", tags.isrc)
    assertEquals(emptyList<Chapter>(), Id3Chapters.parse(tag))
  }

  @Test
  fun neverThrowsOnTruncatedInput() {
    val tags = listOf(
      id3Unsynced(3, id3Frame(3, "TXXX", txxx), id3Frame(3, "CHAP", chapBody("c1", start, start + 1, tit2(3, "One")))),
      id3(4, id3FrameUnsync("TXXX", txxx), id3FramePlain("CHAP", chapBody("c1", 5, 6, tit2(4, "x".repeat(200))))),
      id3(2, id3v22Frame("TXX", txxxBody("ASIN", "B002UZMLXM"))),
    )
    for (tag in tags) {
      for (cut in tag.indices) {
        IdTags.parse("a.mp3", tag.copyOf(cut))
        Id3Chapters.parse(tag.copyOf(cut))
      }
    }
  }
}
