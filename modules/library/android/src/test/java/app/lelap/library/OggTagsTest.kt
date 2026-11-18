package app.lelap.library

import app.lelap.library.Bytes.concat
import app.lelap.library.Bytes.ogg
import app.lelap.library.Bytes.vorbisComments
import org.junit.Assert.assertEquals
import org.junit.Test

/** Vorbis comments in Ogg Vorbis and Opus files. */
class OggTagsTest {
  private val comments = arrayOf(
    "TITLE=Example Book",
    "GENRE=Audiobook",
    "ISRC=XX0AB2400001",
    "ISBN=9780000000002",
    // Long enough to need several pages at two segments a page.
    "DESCRIPTION=" + "x".repeat(1_000),
  )

  @Test
  fun readsOpusTags() {
    val file = ogg(
      7,
      listOf(concat("OpusHead".toByteArray(), ByteArray(11)), concat("OpusTags".toByteArray(), vorbisComments(*comments, "NARRATOR=Example Reader"))),
    )
    val tags = IdTags.parseAll("book.opus", file)
    assertEquals("XX0AB2400001", tags.isrc)
    assertEquals("Audiobook", tags.genre)
    assertEquals("Example Reader", tags.narrator)
    assertEquals(mapOf("ISBN" to "9780000000002"), tags.ids)
  }

  @Test
  fun readsAVorbisCommentPacketThatSpansPages() {
    val identification = concat(byteArrayOf(1), "vorbis".toByteArray(), ByteArray(23))
    val comment = concat(byteArrayOf(3), "vorbis".toByteArray(), vorbisComments(*comments, "READER=Example Reader"), byteArrayOf(1))
    val setup = concat(byteArrayOf(5), "vorbis".toByteArray(), ByteArray(300))
    val file = ogg(7, listOf(identification, comment, setup), segmentsPerPage = 2)
    for (name in listOf("book.ogg", "book.oga")) {
      val tags = IdTags.parseAll(name, file)
      assertEquals("XX0AB2400001", tags.isrc)
      assertEquals("Audiobook", tags.genre)
      assertEquals("Example Reader", tags.narrator)
      assertEquals(mapOf("ISBN" to "9780000000002"), tags.ids)
    }
  }

  @Test
  fun neverThrowsOnTruncatedInput() {
    val file = ogg(7, listOf("OpusHead".toByteArray(), concat("OpusTags".toByteArray(), vorbisComments(*comments))), 2)
    for (cut in file.indices) IdTags.parseAll("a.opus", file.copyOf(cut))
    assertEquals(FileTags(), IdTags.parseAll("a.ogg", ByteArray(100)))
  }
}
