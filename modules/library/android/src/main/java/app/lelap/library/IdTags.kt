package app.lelap.library

import java.nio.ByteBuffer
import java.nio.charset.Charset

/**
 * ISBN and ASIN tags, which Android's metadata reader doesn't give: ID3 `TXXX` frames and MP4
 * `----` items whose name holds “isbn” or ends in “asin”. Values come back raw, by tag name; the
 * app checks and normalises them (`idsFromTags` in the SDK).
 */
object IdTags {
  private const val MAX_FRAME_BYTES = 4 shl 10
  private const val MAX_BOX_BYTES = 8 shl 20
  private const val MAX_TAGS = 16

  fun parse(name: String, read: (offset: Long, length: Int) -> ByteArray, size: Long): Map<String, String> = try {
    when (name.substringAfterLast('.', "").lowercase()) {
      "mp3" -> id3(read, size)
      "m4a", "m4b", "mp4", "aac" -> mp4(read, size)
      else -> emptyMap()
    }
  } catch (e: RuntimeException) {
    // A truncated or odd file has no IDs rather than failing a scan.
    emptyMap()
  }

  fun parse(name: String, bytes: ByteArray): Map<String, String> = parse(
    name,
    { offset, length -> bytes.copyOfRange(offset.toInt(), minOf(bytes.size.toLong(), offset + length).toInt()) },
    bytes.size.toLong(),
  )

  internal fun wanted(tag: String): Boolean {
    val key = tag.lowercase().filter { it.isLetterOrDigit() }
    return key.contains("isbn") || key.endsWith("asin")
  }

  private fun exactly(read: (Long, Int) -> ByteArray, size: Long, offset: Long, length: Int): ByteArray {
    require(offset >= 0 && length >= 0 && offset + length <= size)
    return read(offset, length).also { require(it.size == length) }
  }

  private fun id3(read: (Long, Int) -> ByteArray, size: Long): Map<String, String> {
    if (size < 10) return emptyMap()
    val header = exactly(read, size, 0, 10)
    if (Id3Chapters.tagSize(header) == 0) return emptyMap()
    val version = header[3].toInt()
    if (version != 3 && version != 4) return emptyMap()
    val end = minOf(size, 10L + synchsafe(header, 6))
    var pos = 10L
    if (header[5].toInt() and 0x40 != 0) {
      val ext = exactly(read, size, pos, 4)
      pos += if (version == 4) synchsafe(ext, 0).toLong() else 4L + u32(ext, 0)
    }
    val found = linkedMapOf<String, String>()
    while (pos + 10 <= end && found.size < MAX_TAGS) {
      val frame = exactly(read, size, pos, 10)
      if (frame[0] == 0.toByte()) break
      val id = String(frame, 0, 4, Charsets.ISO_8859_1)
      val frameSize = (if (version == 4) synchsafe(frame, 4) else u32(frame, 4)).toLong() and 0xffffffffL
      if (pos + 10 + frameSize > end) break
      if (id == "TXXX" && frameSize in 2..MAX_FRAME_BYTES) {
        txxx(exactly(read, size, pos + 10, frameSize.toInt()))?.let { (description, value) ->
          if (wanted(description) && value.isNotBlank()) found[description] = value
        }
      }
      pos += 10 + frameSize
    }
    return found
  }

  /** A `TXXX` body: encoding, description, terminator, value. */
  internal fun txxx(body: ByteArray): Pair<String, String>? {
    val encoding = body[0].toInt()
    val charset: Charset = when (encoding) {
      1 -> Charsets.UTF_16
      2 -> Charsets.UTF_16BE
      3 -> Charsets.UTF_8
      else -> Charsets.ISO_8859_1
    }
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

  private fun mp4(read: (Long, Int) -> ByteArray, size: Long): Map<String, String> {
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

    val moov = boxes(0, size).firstOrNull { it.type == "moov" } ?: return emptyMap()
    val meta = child(child(moov, "udta"), "meta") ?: return emptyMap()
    // ISO `meta` is a full box with 4 bytes of version and flags; QuickTime's is not.
    val fullBox = meta.end - meta.bodyStart >= 12 &&
      String(exactly(read, size, meta.bodyStart + 4, 4), Charsets.ISO_8859_1) != "hdlr"
    val ilst = child(meta, "ilst", if (fullBox) 4 else 0) ?: return emptyMap()
    val found = linkedMapOf<String, String>()
    for (item in boxes(ilst.bodyStart, ilst.end)) {
      if (item.type != "----" || found.size >= MAX_TAGS) continue
      if (item.end - item.bodyStart > MAX_BOX_BYTES) continue
      val parts = boxes(item.bodyStart, item.end)
      val name = parts.firstOrNull { it.type == "name" }?.let { text(read, size, it, 4) } ?: continue
      if (!wanted(name)) continue
      val value = parts.firstOrNull { it.type == "data" }?.let { text(read, size, it, 8) } ?: continue
      if (value.isNotBlank()) found[name] = value
    }
    return found
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
