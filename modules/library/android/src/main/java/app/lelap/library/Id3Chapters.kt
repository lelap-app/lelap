package app.lelap.library

import java.nio.charset.Charset

data class Chapter(val title: String, val startMs: Long)

/** Chapters from ID3v2.3/2.4 `CHAP` frames at the start of an mp3. */
object Id3Chapters {
  private const val MAX_FRAME_BYTES = 1 shl 20
  private const val MAX_CHAPTERS = 10_000

  /** Bytes to read for the whole tag, from its 10-byte header; 0 when there is no tag. */
  fun tagSize(header: ByteArray): Int {
    if (header.size < 10 || String(header, 0, 3, Charsets.ISO_8859_1) != "ID3") return 0
    val footer = if (header[5].toInt() and 0x10 != 0) 10 else 0
    return 10 + Id3Frames.synchsafe(header, 6) + footer
  }

  fun parse(tag: ByteArray): List<Chapter> = parse(
    { offset, length -> tag.copyOfRange(offset.toInt(), minOf(tag.size.toLong(), offset + length).toInt()) },
    tag.size.toLong(),
  )

  /** Reads only `CHAP` bodies; [Id3Frames] skips the rest, covers included, without reading them. */
  fun parse(read: (offset: Long, length: Int) -> ByteArray, size: Long): List<Chapter> = try {
    parseUnsafe(read, size)
  } catch (e: RuntimeException) {
    // A truncated or odd tag has no chapters rather than failing a scan.
    emptyList()
  }

  private fun parseUnsafe(read: (Long, Int) -> ByteArray, size: Long): List<Chapter> {
    val found = mutableListOf<Pair<Long, String?>>()
    var tooMany = false
    Id3Frames.walk(read, size, { id, frameSize -> id == "CHAP" && frameSize <= MAX_FRAME_BYTES }) { frame ->
      found += chapter(frame.body, frame.version)
      tooMany = found.size > MAX_CHAPTERS
      !tooMany
    }
    if (tooMany) return emptyList()
    // An untitled chapter stays empty: the app names it in the profile's language.
    return found.sortedBy { it.first }.map { (start, title) -> Chapter(title?.takeIf { it.isNotBlank() } ?: "", start) }
  }

  private fun chapter(body: ByteArray, version: Int): Pair<Long, String?> {
    var pos = 0
    while (body[pos] != 0.toByte()) pos++
    pos++ // element ID and its terminator
    val startMs = Id3Frames.u32(body, pos)
    var title: String? = null
    Id3Frames.subFrames(body, pos + 16, version) { frame ->
      if (frame.id == "TIT2") title = text(frame.body)
    }
    return startMs to title
  }

  private fun text(body: ByteArray): String {
    if (body.isEmpty()) return ""
    val charset: Charset = when (body[0].toInt()) {
      1 -> Charsets.UTF_16
      2 -> Charsets.UTF_16BE
      3 -> Charsets.UTF_8
      else -> Charsets.ISO_8859_1
    }
    return String(body, 1, body.size - 1, charset).trimEnd('\u0000').trim()
  }
}
