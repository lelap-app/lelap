package app.lelap.library

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.Charset

/**
 * What [IdTags] reads. [ids]: ISBN and ASIN tags by name. For telling songs from books (M77): the
 * ISRC, a narrator tag and the MP4 media kind.
 */
data class FileTags(
  val ids: Map<String, String> = emptyMap(),
  val isrc: String? = null,
  val narrator: String? = null,
  /** MP4 `stik`: `music`, `audiobook`, `podcast` or `other`. */
  val mediaKind: String? = null,
)

/**
 * Tags Android's metadata reader doesn't give. ISBN and ASIN: ID3 `TXXX` frames, MP4 `----` items
 * and FLAC comments whose name holds “isbn” or ends in “asin”, raw by tag name; the app checks and
 * normalises them (`idsFromTags` in the SDK). The ISRC comes from ID3 `TSRC`, the MP4
 * `----:com.apple.iTunes:ISRC` item or a FLAC `ISRC` comment; the media kind from MP4 `stik`.
 */
object IdTags {
  private const val MAX_FRAME_BYTES = 4 shl 10
  private const val MAX_BOX_BYTES = 8 shl 20
  private const val MAX_TAGS = 16
  private const val MAX_FLAC_BLOCKS = 64
  private const val MAX_COMMENTS = 256

  /** ISBN and ASIN tags by name. */
  fun parse(name: String, read: (offset: Long, length: Int) -> ByteArray, size: Long): Map<String, String> =
    parseAll(name, read, size).ids

  fun parse(name: String, bytes: ByteArray): Map<String, String> = parseAll(name, bytes).ids

  fun parseAll(name: String, read: (offset: Long, length: Int) -> ByteArray, size: Long): FileTags = try {
    when (name.substringAfterLast('.', "").lowercase()) {
      "mp3" -> id3(read, size)
      "m4a", "m4b", "mp4", "aac" -> mp4(read, size)
      "flac" -> flac(read, size)
      else -> FileTags()
    }
  } catch (e: RuntimeException) {
    // A truncated or odd file has no such tags rather than failing a scan.
    FileTags()
  }

  fun parseAll(name: String, bytes: ByteArray): FileTags = parseAll(
    name,
    { offset, length -> bytes.copyOfRange(offset.toInt(), minOf(bytes.size.toLong(), offset + length).toInt()) },
    bytes.size.toLong(),
  )

  internal fun wanted(tag: String): Boolean {
    val key = tag.lowercase().filter { it.isLetterOrDigit() }
    return key.contains("isbn") || key.endsWith("asin")
  }

  internal fun isIsrc(tag: String) = tag.lowercase().filter { it.isLetter() } == "isrc"

  internal fun isNarrator(tag: String) =
    tag.lowercase().filter { it.isLetter() } in setOf("narrator", "narratedby", "reader")

  /** MP4 `stik` values as Apple uses them; 2 is an audiobook. */
  internal fun mediaKind(stik: Int): String = when (stik) {
    0, 1 -> "music"
    2 -> "audiobook"
    21 -> "podcast"
    else -> "other"
  }

  /** Collects tags by name, whichever container they come from. */
  private class Found {
    val ids = linkedMapOf<String, String>()
    var isrc: String? = null
    var narrator: String? = null
    var mediaKind: String? = null

    fun add(name: String, value: String) {
      if (value.isBlank()) return
      if (wanted(name) && ids.size < MAX_TAGS) ids[name] = value
      if (isIsrc(name)) isrc = isrc ?: value
      if (isNarrator(name)) narrator = narrator ?: value
    }

    fun tags() = FileTags(ids, isrc, narrator, mediaKind)
  }

  private fun exactly(read: (Long, Int) -> ByteArray, size: Long, offset: Long, length: Int): ByteArray {
    require(offset >= 0 && length >= 0 && offset + length <= size)
    return read(offset, length).also { require(it.size == length) }
  }

  private fun id3(read: (Long, Int) -> ByteArray, size: Long): FileTags {
    if (size < 10) return FileTags()
    val header = exactly(read, size, 0, 10)
    if (Id3Chapters.tagSize(header) == 0) return FileTags()
    val version = header[3].toInt()
    if (version != 3 && version != 4) return FileTags()
    val end = minOf(size, 10L + synchsafe(header, 6))
    var pos = 10L
    if (header[5].toInt() and 0x40 != 0) {
      val ext = exactly(read, size, pos, 4)
      pos += if (version == 4) synchsafe(ext, 0).toLong() else 4L + u32(ext, 0)
    }
    val found = Found()
    while (pos + 10 <= end && found.ids.size < MAX_TAGS) {
      val frame = exactly(read, size, pos, 10)
      if (frame[0] == 0.toByte()) break
      val id = String(frame, 0, 4, Charsets.ISO_8859_1)
      val frameSize = (if (version == 4) synchsafe(frame, 4) else u32(frame, 4)).toLong() and 0xffffffffL
      if (pos + 10 + frameSize > end) break
      if (id == "TXXX" && frameSize in 2..MAX_FRAME_BYTES) {
        txxx(exactly(read, size, pos + 10, frameSize.toInt()))?.let { (description, value) ->
          found.add(description, value)
        }
      }
      if (id == "TSRC" && frameSize in 2..MAX_FRAME_BYTES) {
        textFrame(exactly(read, size, pos + 10, frameSize.toInt()))?.let { found.isrc = it }
      }
      pos += 10 + frameSize
    }
    return found.tags()
  }

  private fun charsetOf(encoding: Int): Charset = when (encoding) {
    1 -> Charsets.UTF_16
    2 -> Charsets.UTF_16BE
    3 -> Charsets.UTF_8
    else -> Charsets.ISO_8859_1
  }

  /** A text frame such as `TSRC`: encoding, then the text. */
  internal fun textFrame(body: ByteArray): String? =
    String(body, 1, body.size - 1, charsetOf(body[0].toInt())).trimEnd('\u0000').trim().takeIf { it.isNotEmpty() }

  /** A `TXXX` body: encoding, description, terminator, value. */
  internal fun txxx(body: ByteArray): Pair<String, String>? {
    val encoding = body[0].toInt()
    val charset = charsetOf(encoding)
    val wide = encoding == 1 || encoding == 2
    var split = 1
    while (true) {
      if (split + (if (wide) 1 else 0) >= body.size) return null
      if (!wide && body[split] == 0.toByte()) break
      if (wide && body[split] == 0.toByte() && body[split + 1] == 0.toByte()) break
      split += if (wide) 2 else 1
    }
    val description = String(body, 1, split - 1, charset).trim()
    val valueStart = split + if (wide) 2 else 1
    // UTF-16 values carry their own byte order mark; the description's doesn't apply.
    val value = String(body, valueStart, body.size - valueStart, charset).trimEnd('\u0000').trim()
    return description to value
  }

  private class Box(val type: String, val bodyStart: Long, val end: Long)

  private fun mp4(read: (Long, Int) -> ByteArray, size: Long): FileTags {
    fun boxes(start: Long, end: Long): List<Box> {
      val result = mutableListOf<Box>()
      var pos = start
      while (pos + 8 <= end) {
        val header = ByteBuffer.wrap(exactly(read, size, pos, 8))
        var length = header.int.toLong() and 0xffffffffL
        val type = String(header.array(), 4, 4, Charsets.ISO_8859_1)
        var bodyStart = pos + 8
        if (length == 1L) {
          length = ByteBuffer.wrap(exactly(read, size, pos + 8, 8)).long
          bodyStart = pos + 16
        } else if (length == 0L) {
          length = end - pos
        }
        if (length < bodyStart - pos || pos + length > end) break
        result += Box(type, bodyStart, pos + length)
        pos += length
      }
      return result
    }
    fun child(parent: Box?, type: String, skip: Long = 0): Box? =
      parent?.let { p -> boxes(p.bodyStart + skip, p.end).firstOrNull { it.type == type } }

    val moov = boxes(0, size).firstOrNull { it.type == "moov" } ?: return FileTags()
    val meta = child(child(moov, "udta"), "meta") ?: return FileTags()
    // ISO `meta` is a full box with 4 bytes of version and flags; QuickTime's is not.
    val fullBox = meta.end - meta.bodyStart >= 12 &&
      String(exactly(read, size, meta.bodyStart + 4, 4), Charsets.ISO_8859_1) != "hdlr"
    val ilst = child(meta, "ilst", if (fullBox) 4 else 0) ?: return FileTags()
    val found = Found()
    for (item in boxes(ilst.bodyStart, ilst.end)) {
      if (item.end - item.bodyStart > MAX_BOX_BYTES) continue
      when (item.type) {
        "stik" -> {
          val data = boxes(item.bodyStart, item.end).firstOrNull { it.type == "data" } ?: continue
          // 8 bytes of type and locale, then the value: one byte, sometimes more, big-endian.
          val length = (data.end - data.bodyStart - 8).toInt()
          if (length !in 1..4) continue
          val bytes = exactly(read, size, data.bodyStart + 8, length)
          found.mediaKind = mediaKind(bytes.fold(0) { acc, b -> (acc shl 8) or (b.toInt() and 0xff) })
        }
        NARRATOR_ATOM -> {
          val data = boxes(item.bodyStart, item.end).firstOrNull { it.type == "data" } ?: continue
          text(read, size, data, 8)?.let { found.add("narrator", it) }
        }
        "----" -> {
          val parts = boxes(item.bodyStart, item.end)
          val name = parts.firstOrNull { it.type == "name" }?.let { text(read, size, it, 4) } ?: continue
          if (!wanted(name) && !isIsrc(name) && !isNarrator(name)) continue
          val value = parts.firstOrNull { it.type == "data" }?.let { text(read, size, it, 8) } ?: continue
          found.add(name, value)
        }
      }
    }
    return found.tags()
  }

  /** Apple's narrator item, `©nrt`. */
  private const val NARRATOR_ATOM = "©nrt"

  /**
   * FLAC: `fLaC`, then metadata blocks of a one-byte type (top bit: the last block) and a 24-bit
   * length. The Vorbis comment block, type 4, is little-endian, with `KEY=value` comments.
   */
  private fun flac(read: (Long, Int) -> ByteArray, size: Long): FileTags {
    if (size < 8 || String(exactly(read, size, 0, 4), Charsets.ISO_8859_1) != "fLaC") return FileTags()
    var pos = 4L
    repeat(MAX_FLAC_BLOCKS) {
      val header = exactly(read, size, pos, 4)
      val type = header[0].toInt() and 0x7f
      val length = ((header[1].toInt() and 0xff) shl 16) or ((header[2].toInt() and 0xff) shl 8) or
        (header[3].toInt() and 0xff)
      if (type == 4) return vorbisComments(exactly(read, size, pos + 4, length))
      if (header[0].toInt() and 0x80 != 0) return FileTags()
      pos += 4L + length
    }
    return FileTags()
  }

  internal fun vorbisComments(body: ByteArray): FileTags {
    val buffer = ByteBuffer.wrap(body).order(ByteOrder.LITTLE_ENDIAN)
    val vendor = buffer.int
    require(vendor in 0..buffer.remaining())
    buffer.position(buffer.position() + vendor)
    val count = buffer.int
    val found = Found()
    for (i in 0 until minOf(count, MAX_COMMENTS)) {
      val length = buffer.int
      require(length in 0..buffer.remaining())
      val comment = String(body, buffer.position(), length, Charsets.UTF_8)
      buffer.position(buffer.position() + length)
      val key = comment.substringBefore('=', "")
      if (key.isNotEmpty()) found.add(key, comment.substringAfter('=').trim())
    }
    return found.tags()
  }

  private fun text(read: (Long, Int) -> ByteArray, size: Long, box: Box, skip: Int): String? {
    val length = (box.end - box.bodyStart - skip).toInt()
    if (length < 0 || length > MAX_FRAME_BYTES) return null
    return String(exactly(read, size, box.bodyStart + skip, length), Charsets.UTF_8).trimEnd('\u0000').trim()
  }

  private fun synchsafe(b: ByteArray, at: Int) =
    ((b[at].toInt() and 0x7f) shl 21) or ((b[at + 1].toInt() and 0x7f) shl 14) or
      ((b[at + 2].toInt() and 0x7f) shl 7) or (b[at + 3].toInt() and 0x7f)

  private fun u32(b: ByteArray, at: Int) =
    ((b[at].toInt() and 0xff) shl 24) or ((b[at + 1].toInt() and 0xff) shl 16) or
      ((b[at + 2].toInt() and 0xff) shl 8) or (b[at + 3].toInt() and 0xff)
}
