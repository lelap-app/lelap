package app.lelap.library

import app.lelap.library.Bytes.atom
import app.lelap.library.Bytes.concat
import app.lelap.library.Bytes.id3
import app.lelap.library.Bytes.id3Frame
import app.lelap.library.Bytes.tit2
import app.lelap.library.Bytes.u32
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** ISRC, narrator and media kind (M77), which tell a song from a book. */
class KindTagsTest {
  private fun text(id: String, value: String) =
    id3Frame(4, id, concat(byteArrayOf(3), value.toByteArray(Charsets.UTF_8)))

  private fun txxx(description: String, value: String) = id3Frame(
    4,
    "TXXX",
    concat(byteArrayOf(3), description.toByteArray(), byteArrayOf(0), value.toByteArray()),
  )

  @Test
  fun readsIsrcAndNarratorFromId3() {
    val tag = id3(4, tit2(4, "Example Song"), text("TSRC", "XX0AB2400001"), txxx("NARRATOR", "Example Reader"))
    val tags = IdTags.parseAll("song.mp3", tag)
    assertEquals("XX0AB2400001", tags.isrc)
    assertEquals("Example Reader", tags.narrator)
    assertNull(tags.mediaKind)
    assertEquals(emptyMap<String, String>(), tags.ids)
  }

  private fun mp4(vararg items: ByteArray) = concat(
    atom("ftyp", "M4A ".toByteArray()),
    atom("moov", atom("udta", atom("meta", u32(0), atom("hdlr", ByteArray(25)), atom("ilst", *items)))),
  )

  private fun freeform(name: String, value: String) = atom(
    "----",
    atom("mean", u32(0), "com.apple.iTunes".toByteArray()),
    atom("name", u32(0), name.toByteArray()),
    atom("data", u32(1), u32(0), value.toByteArray()),
  )

  private fun stik(kind: Int) = atom("stik", atom("data", u32(21), u32(0), byteArrayOf(kind.toByte())))

  @Test
  fun readsMediaKindAndIsrcFromMp4() {
    val song = IdTags.parseAll("song.m4a", mp4(stik(1), freeform("ISRC", "XX0AB2400001")))
    assertEquals("music", song.mediaKind)
    assertEquals("XX0AB2400001", song.isrc)
    val book = IdTags.parseAll(
      "book.m4a",
      mp4(stik(2), atom("©nrt", atom("data", u32(1), u32(0), "Example Reader".toByteArray()))),
    )
    assertEquals("audiobook", book.mediaKind)
    assertEquals("Example Reader", book.narrator)
    assertEquals("podcast", IdTags.parseAll("a.m4a", mp4(stik(21))).mediaKind)
  }

  private fun le32(n: Int) = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(n).array()

  private fun block(type: Int, last: Boolean, body: ByteArray) = concat(
    byteArrayOf(
      ((if (last) 0x80 else 0) or type).toByte(),
      (body.size shr 16).toByte(),
      (body.size shr 8).toByte(),
      body.size.toByte(),
    ),
    body,
  )

  private fun flac(vararg comments: String): ByteArray {
    val vendor = "example".toByteArray()
    val body = concat(
      le32(vendor.size),
      vendor,
      le32(comments.size),
      *comments.map { concat(le32(it.toByteArray().size), it.toByteArray()) }.toTypedArray(),
    )
    return concat("fLaC".toByteArray(), block(0, false, ByteArray(34)), block(4, true, body))
  }

  @Test
  fun readsFlacComments() {
    val tags = IdTags.parseAll("song.flac", flac("TITLE=Example Song", "isrc=XX0AB2400001", "ISBN=9780000000002"))
    assertEquals("XX0AB2400001", tags.isrc)
    assertEquals(mapOf("ISBN" to "9780000000002"), tags.ids)
  }

  @Test
  fun neverThrowsOnTruncatedInput() {
    val file = flac("ISRC=XX0AB2400001", "NARRATOR=Example Reader")
    for (cut in file.indices) IdTags.parseAll("a.flac", file.copyOf(cut))
    val box = mp4(stik(2), freeform("ISRC", "XX0AB2400001"))
    for (cut in box.indices) IdTags.parseAll("a.m4a", box.copyOf(cut))
  }

  @Test
  fun readsTheAsinFromAudiblesCdekItem() {
    val file = mp4(stik(2), atom("CDEK", atom("data", u32(1), u32(0), "B002UZMLXM".toByteArray())))
    assertEquals(mapOf("asin" to "B002UZMLXM"), IdTags.parseAll("book.m4b", file).ids)
  }

  @Test
  fun readsTheGenreFromFlac() {
    assertEquals("Audiobook", IdTags.parseAll("book.flac", flac("GENRE=Audiobook")).genre)
  }

  @Test
  fun readsTheSeriesFromId3() {
    val tags = IdTags.parseAll("book.mp3", id3(4, txxx("SERIES", "Dune"), txxx("SERIES-PART", "2")))
    assertEquals("Dune #2", tags.series)
    // The movement name and number, as tagging apps write them for audiobooks.
    val movement = IdTags.parseAll("book.mp3", id3(4, text("MVNM", "The Expanse"), text("MVIN", "3/9")))
    assertEquals("The Expanse #3", movement.series)
    assertNull(IdTags.parseAll("book.mp3", id3(4, text("MVIN", "3"))).series)
  }

  @Test
  fun takesTheNumberFromTheSameFamilyAsTheName() {
    // A series name with only a movement number: the movement may count something else.
    val mixed = IdTags.parseAll("book.mp3", id3(4, txxx("SERIES", "Dune"), text("MVIN", "4")))
    assertEquals("Dune", mixed.series)
    // Both families: the series tags win, each with its own number.
    val both = IdTags.parseAll(
      "book.mp3",
      id3(4, text("MVNM", "Movement"), text("MVIN", "4"), txxx("SERIES", "Dune"), txxx("SERIES-PART", "2")),
    )
    assertEquals("Dune #2", both.series)
    assertEquals("Discworld #3", IdTags.parseAll("book.flac", flac("MOVEMENTNAME=Discworld", "MOVEMENT=3", "SERIESPART=9")).series)
  }

  @Test
  fun readsTheSeriesFromMp4AndFlac() {
    val book = IdTags.parseAll(
      "book.m4b",
      mp4(
        atom("©mvn", atom("data", u32(1), u32(0), "Discworld".toByteArray())),
        atom("©mvi", atom("data", u32(21), u32(0), byteArrayOf(0, 12))),
      ),
    )
    assertEquals("Discworld #12", book.series)
    val freeform = IdTags.parseAll("book.m4b", mp4(freeform("SERIES", "Dune"), freeform("SERIES-PART", "1.5")))
    assertEquals("Dune #1.5", freeform.series)
    assertEquals("Dune", IdTags.parseAll("book.flac", flac("SERIES=Dune")).series)
    assertEquals("Dune #4", IdTags.parseAll("book.flac", flac("series=Dune", "SERIESPART=4")).series)
  }

  @Test
  fun writesTheSeriesAsServersDo() {
    assertEquals("Dune #1", IdTags.seriesText(" Dune ", "1/6"))
    assertEquals("Dune #0", IdTags.seriesText("Dune", "0"))
    assertEquals("Dune #1.5", IdTags.seriesText("Dune", "1,5"))
    assertEquals("Dune", IdTags.seriesText("Dune", " "))
    assertEquals("Dune #2", IdTags.seriesText("Dune #", "#2"))
    assertNull(IdTags.seriesText(" ", "2"))
  }

  @Test
  fun mapsStikValues() {
    assertEquals("music", IdTags.mediaKind(1))
    assertEquals("audiobook", IdTags.mediaKind(2))
    assertEquals("other", IdTags.mediaKind(6))
  }
}
