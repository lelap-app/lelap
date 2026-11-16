package app.lelap.library

import java.nio.charset.Charset

data class Chapter(val title: String, val startMs: Long)

/** Chapters from ID3v2.3/2.4 `CHAP` frames at the start of an mp3. */
object Id3Chapters {
  /** Bytes to read for the whole tag, from its 10-byte header; 0 when there is no tag. */
  fun tagSize(header: ByteArray): Int {
    if (header.size < 10 || String(header, 0, 3, Charsets.ISO_8859_1) != "ID3") return 0
    val footer = if (header[5].toInt() and 0x10 != 0) 10 else 0
    return 10 + synchsafe(header, 6) + footer
  }

  fun parse(tag: ByteArray): List<Chapter> = try {
    parseUnsafe(tag)
  } catch (e: IndexOutOfBoundsException) {
    emptyList()
  }

  private fun parseUnsafe(tag: ByteArray): List<Chapter> {
    if (tagSize(tag) == 0) return emptyList()
    val version = tag[3].toInt()
    if (version != 3 && version != 4) return emptyList()
    val end = minOf(tag.size, 10 + synchsafe(tag, 6))
    var pos = 10
    if (tag[5].toInt() and 0x40 != 0) {
      pos += if (version == 4) synchsafe(tag, pos) else 4 + u32(tag, pos)
    }
    val found = mutableListOf<Pair<Long, String?>>()
    forEachFrame(tag, pos, end, version) { id, bodyStart, bodyEnd ->
      if (id == "CHAP") found += chapter(tag, bodyStart, bodyEnd, version)
    }
    return found.sortedBy { it.first }.mapIndexed { i, (start, title) ->
      Chapter(title?.takeIf { it.isNotBlank() } ?: "Chapter ${i + 1}", start)
    }
  }

  private fun chapter(tag: ByteArray, start: Int, end: Int, version: Int): Pair<Long, String?> {
    var pos = start
    while (tag[pos] != 0.toByte()) pos++
    pos++ // element ID and its terminator
    val startMs = u32(tag, pos).toLong() and 0xffffffffL
    var title: String? = null
    forEachFrame(tag, pos + 16, end, version) { id, bodyStart, bodyEnd ->
      if (id == "TIT2") title = text(tag, bodyStart, bodyEnd)
    }
    return startMs to title
  }

  private inline fun forEachFrame(
    tag: ByteArray,
    from: Int,
    end: Int,
    version: Int,
    block: (id: String, bodyStart: Int, bodyEnd: Int) -> Unit,
  ) {
    var pos = from
    while (pos + 10 <= end && tag[pos] != 0.toByte()) {
      val id = String(tag, pos, 4, Charsets.ISO_8859_1)
      val size = if (version == 4) synchsafe(tag, pos + 4) else u32(tag, pos + 4)
      if (size < 0 || pos + 10 + size > end) return
      block(id, pos + 10, pos + 10 + size)
      pos += 10 + size
    }
  }

  private fun text(tag: ByteArray, start: Int, end: Int): String {
    if (end <= start) return ""
    val charset: Charset = when (tag[start].toInt()) {
      1 -> Charsets.UTF_16
      2 -> Charsets.UTF_16BE
      3 -> Charsets.UTF_8
      else -> Charsets.ISO_8859_1
    }
    return String(tag, start + 1, end - start - 1, charset).trimEnd('\u0000').trim()
  }

  private fun synchsafe(b: ByteArray, at: Int) =
    ((b[at].toInt() and 0x7f) shl 21) or ((b[at + 1].toInt() and 0x7f) shl 14) or
      ((b[at + 2].toInt() and 0x7f) shl 7) or (b[at + 3].toInt() and 0x7f)

  private fun u32(b: ByteArray, at: Int) =
    ((b[at].toInt() and 0xff) shl 24) or ((b[at + 1].toInt() and 0xff) shl 16) or
      ((b[at + 2].toInt() and 0xff) shl 8) or (b[at + 3].toInt() and 0xff)
}
