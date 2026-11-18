package app.lelap.library

import app.lelap.library.Bytes.atom
import app.lelap.library.Bytes.concat
import app.lelap.library.Bytes.id3
import app.lelap.library.Bytes.id3Frame
import app.lelap.library.Bytes.tit2
import app.lelap.library.Bytes.u32
import org.junit.Assert.assertEquals
import org.junit.Test

class IdTagsTest {
  private fun txxx(version: Int, description: String, value: String, encoding: Int = 3): ByteArray {
    val charset = if (encoding == 1) Charsets.UTF_16 else Charsets.UTF_8
    val terminator = if (encoding == 1) byteArrayOf(0, 0) else byteArrayOf(0)
    return id3Frame(
      version,
      "TXXX",
      concat(byteArrayOf(encoding.toByte()), description.toByteArray(charset), terminator, value.toByteArray(charset)),
    )
  }

  @Test
  fun readsIsbnAndAsinFromId3() {
    val tag = id3(
      4,
      tit2(4, "Dune"),
      txxx(4, "ISBN", "978-0-441-01359-3"),
      txxx(4, "AUDIBLE_ASIN", "B002UZMLXM"),
      txxx(4, "MusicBrainz Album Id", "not wanted"),
    )
    assertEquals(
      mapOf("ISBN" to "978-0-441-01359-3", "AUDIBLE_ASIN" to "B002UZMLXM"),
      IdTags.parse("book.mp3", tag),
    )
  }

  @Test
  fun readsUtf16AndId3v23() {
    val tag = id3(3, txxx(3, "ASIN", "B00B5HZGUM", encoding = 1))
    assertEquals(mapOf("ASIN" to "B00B5HZGUM"), IdTags.parse("book.mp3", tag))
  }

  private fun freeform(name: String, value: String) = atom(
    "----",
    atom("mean", u32(0), "com.apple.iTunes".toByteArray()),
    atom("name", u32(0), name.toByteArray()),
    atom("data", u32(1), u32(0), value.toByteArray()),
  )

  @Test
  fun readsFreeformItemsFromMp4() {
    val file = concat(
      atom("ftyp", "M4B ".toByteArray()),
      atom(
        "moov",
        atom(
          "udta",
          atom(
            "meta",
            u32(0),
            atom("hdlr", ByteArray(25)),
            atom("ilst", freeform("ASIN", "B002UZMLXM"), freeform("Encoder", "x")),
          ),
        ),
      ),
    )
    assertEquals(mapOf("ASIN" to "B002UZMLXM"), IdTags.parse("book.m4b", file))
  }

  @Test
  fun readsQuickTimeMetaWithoutVersion() {
    val file = atom("moov", atom("udta", atom("meta", atom("hdlr", ByteArray(25)), atom("ilst", freeform("ISBN", "0441013597")))))
    assertEquals(mapOf("ISBN" to "0441013597"), IdTags.parse("book.m4a", file))
  }

  @Test
  fun neverThrowsOnTruncatedInput() {
    val tag = id3(4, txxx(4, "ISBN", "9780441013593"), txxx(4, "ASIN", "B002UZMLXM"))
    for (cut in tag.indices) IdTags.parse("a.mp3", tag.copyOf(cut))
    val file = atom("moov", atom("udta", atom("meta", u32(0), atom("ilst", freeform("ASIN", "B002UZMLXM")))))
    for (cut in file.indices) IdTags.parse("a.m4b", file.copyOf(cut))
  }

  @Test
  fun knowsOtherFilesHaveNone() {
    assertEquals(emptyMap<String, String>(), IdTags.parse("a.flac", ByteArray(100)))
  }
}
