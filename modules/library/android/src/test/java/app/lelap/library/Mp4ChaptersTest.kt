package app.lelap.library

import app.lelap.library.Bytes.atom
import app.lelap.library.Bytes.concat
import app.lelap.library.Bytes.u16
import app.lelap.library.Bytes.u32
import app.lelap.library.Bytes.u64
import org.junit.Assert.assertEquals
import org.junit.Test

class Mp4ChaptersTest {
  private fun parse(file: ByteArray) = Mp4Chapters.parse({ offset, length ->
    file.copyOfRange(offset.toInt(), minOf(file.size, offset.toInt() + length))
  }, file.size.toLong())

  private fun chplEntry(start100ns: Long, title: String): ByteArray {
    val text = title.toByteArray(Charsets.UTF_8)
    return concat(u64(start100ns), byteArrayOf(text.size.toByte()), text)
  }

  private fun chpl(vararg entries: ByteArray) =
    atom("chpl", byteArrayOf(1, 0, 0, 0), u32(0), byteArrayOf(entries.size.toByte()), *entries)

  @Test
  fun readsNeroChapters() {
    val file = concat(
      atom("ftyp", "M4B ".toByteArray()),
      atom("moov", atom("mvhd", ByteArray(100)), atom("udta", chpl(chplEntry(0, "Intro"), chplEntry(15_000_000, "Første"), chplEntry(600_000_000, "Last")))),
      atom("mdat", ByteArray(64)),
    )
    assertEquals(
      listOf(Chapter("Intro", 0), Chapter("Første", 1_500), Chapter("Last", 60_000)),
      parse(file),
    )
  }

  private fun sample(text: ByteArray) = concat(u16(text.size), text)

  @Test
  fun readsAQuickTimeChapterTrack() {
    val samples = listOf(sample("One".toByteArray()), sample("Two".toByteArray()))
    assertEquals(listOf(Chapter("One", 0), Chapter("Two", 30_000)), parse(quickTime(samples)))
  }

  @Test
  fun readsUtf16ChapterTitlesWithAByteOrderMark() {
    val bom = byteArrayOf(0xfe.toByte(), 0xff.toByte())
    val samples = listOf(sample(concat(bom, "Første".toByteArray(Charsets.UTF_16BE))), sample("Two".toByteArray()))
    assertEquals(listOf(Chapter("Første", 0), Chapter("Two", 30_000)), parse(quickTime(samples)))
  }

  /** A file whose QuickTime text track holds two chapter samples, at 0 and 30 s. */
  private fun quickTime(samples: List<ByteArray>): ByteArray {
    val mdat = atom("mdat", *samples.toTypedArray())
    val ftyp = atom("ftyp", "M4B ".toByteArray())
    val firstSample = ftyp.size + 8L

    fun fullBox(type: String, vararg body: ByteArray) = atom(type, u32(0), *body)
    val textTrack = atom(
      "trak",
      fullBox("tkhd", ByteArray(8), u32(2)),
      atom(
        "mdia",
        fullBox("mdhd", u32(0), u32(0), u32(1000), u32(0), ByteArray(4)),
        fullBox("hdlr", u32(0), "text".toByteArray(), ByteArray(12), byteArrayOf(0)),
        atom(
          "minf",
          atom(
            "stbl",
            fullBox("stts", u32(2), u32(1), u32(30_000), u32(1), u32(45_000)),
            fullBox("stsc", u32(1), u32(1), u32(2), u32(1)),
            fullBox("stsz", u32(0), u32(2), u32(samples[0].size.toLong()), u32(samples[1].size.toLong())),
            fullBox("stco", u32(1), u32(firstSample)),
          ),
        ),
      ),
    )
    val audioTrack = atom(
      "trak",
      fullBox("tkhd", ByteArray(8), u32(1)),
      atom("tref", atom("chap", u32(2))),
      atom("mdia", fullBox("hdlr", u32(0), "soun".toByteArray(), ByteArray(12), byteArrayOf(0))),
    )
    return concat(ftyp, mdat, atom("moov", atom("mvhd", ByteArray(100)), audioTrack, textTrack))
  }

  @Test
  fun returnsNothingWithoutChapters() {
    assertEquals(emptyList<Chapter>(), parse(concat(atom("ftyp"), atom("moov", atom("mvhd", ByteArray(100))))))
  }

  @Test
  fun neverThrowsOnTruncatedInput() {
    val file = concat(atom("moov", atom("udta", chpl(chplEntry(0, "A"), chplEntry(10, "B")))))
    for (cut in file.indices) parse(file.copyOf(cut))
  }

  @Test
  fun ignoresAbsurdSampleCountsWithoutAllocating() {
    fun fullBox(type: String, vararg body: ByteArray) = atom(type, u32(0), *body)
    val textTrack = atom(
      "trak",
      fullBox("tkhd", ByteArray(8), u32(2)),
      atom(
        "mdia",
        fullBox("mdhd", u32(0), u32(0), u32(1000), u32(0), ByteArray(4)),
        atom(
          "minf",
          atom(
            "stbl",
            fullBox("stts", u32(1), u32(0x7fffffff), u32(1)),
            fullBox("stsc", u32(1), u32(1), u32(0x7fffffff), u32(1)),
            fullBox("stsz", u32(10), u32(0x7fffffff)),
            fullBox("stco", u32(1), u32(0)),
          ),
        ),
      ),
    )
    val audioTrack = atom("trak", fullBox("tkhd", ByteArray(8), u32(1)), atom("tref", atom("chap", u32(2))))
    assertEquals(emptyList<Chapter>(), parse(concat(atom("moov", audioTrack, textTrack))))
  }
}
