package app.lelap.library

import java.io.ByteArrayOutputStream

/** One frame of an ID3v2 tag, its body with unsynchronisation and prefixes undone. */
internal class Id3Frame(val id: String, val body: ByteArray, val version: Int)

/**
 * The frames of an ID3v2.2, 2.3 or 2.4 tag at the start of a file, for [Id3Chapters] and
 * [IdTags]. Reads frame headers with small reads and only the bodies a caller wants, so a
 * multi-MB cover picture or a bogus tag size never costs memory.
 */
internal object Id3Frames {
  /** A v2.2 or v2.3 tag unsynchronised as a whole is read at once to undo it. */
  private const val MAX_UNSYNC_TAG = 8 shl 20

  /**
   * Calls [block] with each frame whose ID and stored size [wanted] accepts, until it returns
   * false. Throws on a truncated file; callers treat that as no tags.
   */
  fun walk(
    read: (offset: Long, length: Int) -> ByteArray,
    size: Long,
    wanted: (id: String, size: Long) -> Boolean,
    block: (Id3Frame) -> Boolean,
  ) {
    if (size < 10) return
    val header = exactly(read, size, 0, 10)
    if (Id3Chapters.tagSize(header) == 0) return
    val version = header[3].toInt()
    if (version !in 2..4) return
    val flags = header[5].toInt()
    // In v2.2 this flag means compression, which was never defined.
    if (version == 2 && flags and 0x40 != 0) return
    val unsync = flags and 0x80 != 0
    var source = read
    var sourceSize = size
    var end = minOf(size, 10L + synchsafe(header, 6))
    if (unsync && version < 4) {
      if (end - 10 > MAX_UNSYNC_TAG) return
      val tag = header + undoUnsync(exactly(read, size, 10, (end - 10).toInt()))
      source = slice(tag)
      sourceSize = tag.size.toLong()
      end = sourceSize
    }
    var pos = 10L
    if (version > 2 && flags and 0x40 != 0) {
      val ext = exactly(source, sourceSize, pos, 4)
      pos += if (version == 4) synchsafe(ext, 0).toLong() else 4L + u32(ext, 0)
    }
    frames(source, sourceSize, pos, end, version, unsync && version == 4, wanted, block)
  }

  /** The frames inside a frame body, such as the `TIT2` of a `CHAP`, from [from] on. */
  fun subFrames(body: ByteArray, from: Int, version: Int, block: (Id3Frame) -> Unit) =
    frames(slice(body), body.size.toLong(), from.toLong(), body.size.toLong(), version, false, { _, _ -> true }) {
      block(it)
      true
    }

  private fun frames(
    read: (Long, Int) -> ByteArray,
    size: Long,
    from: Long,
    end: Long,
    version: Int,
    unsyncAll: Boolean,
    wanted: (id: String, size: Long) -> Boolean,
    block: (Id3Frame) -> Boolean,
  ) {
    val headerSize = if (version == 2) 6 else 10
    var pos = from
    while (pos + headerSize <= end) {
      val header = exactly(read, size, pos, headerSize)
      if (header[0] == 0.toByte()) break
      val id = String(header, 0, if (version == 2) 3 else 4, Charsets.ISO_8859_1)
      val bodyStart = pos + headerSize
      val frameSize = when (version) {
        2 -> u24(header, 3)
        3 -> u32(header, 4)
        else -> v4Size(header, bodyStart, end) { at, n -> exactly(read, size, at, n) }
      }
      if (bodyStart + frameSize > end) break
      val format = if (version == 2) 0 else header[9].toInt() and 0xff
      // Compressed or encrypted frames: v2.3 marks them 0x80 and 0x40, v2.4 0x08 and 0x04.
      val unreadable = when (version) {
        3 -> format and 0xc0 != 0
        4 -> format and 0x0c != 0
        else -> false
      }
      if (!unreadable && wanted(id, frameSize)) {
        val stored = exactly(read, size, bodyStart, frameSize.toInt())
        // A group byte, then in v2.4 a 4-byte data length indicator, come before the data.
        val prefix = when (version) {
          3 -> if (format and 0x20 != 0) 1 else 0
          4 -> (if (format and 0x40 != 0) 1 else 0) + (if (format and 0x01 != 0) 4 else 0)
          else -> 0
        }
        require(prefix <= stored.size)
        var body = stored.copyOfRange(prefix, stored.size)
        if (version == 4 && (unsyncAll || format and 0x02 != 0)) body = undoUnsync(body)
        if (!block(Id3Frame(id, body, version))) return
      }
      pos = bodyStart + frameSize
    }
  }

  /**
   * A v2.4 frame size should be synchsafe, but some taggers write a plain 32-bit number. When the
   * two readings differ, the one followed by another frame header, padding or the tag's end wins.
   */
  private fun v4Size(header: ByteArray, bodyStart: Long, end: Long, peek: (Long, Int) -> ByteArray): Long {
    val plain = u32(header, 4)
    if ((4..7).any { header[it].toInt() and 0x80 != 0 }) return plain
    val safe = synchsafe(header, 4).toLong()
    if (safe == plain || nextIsFrame(bodyStart + safe, end, peek)) return safe
    return if (nextIsFrame(bodyStart + plain, end, peek)) plain else safe
  }

  private fun nextIsFrame(at: Long, end: Long, peek: (Long, Int) -> ByteArray): Boolean {
    if (at == end) return true
    if (at > end) return false
    val bytes = peek(at, minOf(4L, end - at).toInt())
    return bytes.all { it == 0.toByte() } ||
      (bytes.size == 4 && bytes.all { it.toInt().toChar() in 'A'..'Z' || it.toInt().toChar() in '0'..'9' })
  }

  /** Unsynchronisation put a zero byte after every 0xFF that could look like an MPEG sync. */
  fun undoUnsync(bytes: ByteArray): ByteArray {
    val out = ByteArrayOutputStream(bytes.size)
    var i = 0
    while (i < bytes.size) {
      out.write(bytes[i].toInt())
      i += if (bytes[i] == 0xff.toByte() && i + 1 < bytes.size && bytes[i + 1] == 0.toByte()) 2 else 1
    }
    return out.toByteArray()
  }

  private fun slice(bytes: ByteArray): (Long, Int) -> ByteArray =
    { offset, length -> bytes.copyOfRange(offset.toInt(), minOf(bytes.size.toLong(), offset + length).toInt()) }

  private fun exactly(read: (Long, Int) -> ByteArray, size: Long, offset: Long, length: Int): ByteArray {
    require(offset >= 0 && length >= 0 && offset + length <= size)
    return read(offset, length).also { require(it.size == length) }
  }

  fun synchsafe(b: ByteArray, at: Int) =
    ((b[at].toInt() and 0x7f) shl 21) or ((b[at + 1].toInt() and 0x7f) shl 14) or
      ((b[at + 2].toInt() and 0x7f) shl 7) or (b[at + 3].toInt() and 0x7f)

  private fun u24(b: ByteArray, at: Int): Long =
    (((b[at].toInt() and 0xff) shl 16) or ((b[at + 1].toInt() and 0xff) shl 8) or (b[at + 2].toInt() and 0xff)).toLong()

  fun u32(b: ByteArray, at: Int): Long =
    ((b[at].toLong() and 0xff) shl 24) or ((b[at + 1].toLong() and 0xff) shl 16) or
      ((b[at + 2].toLong() and 0xff) shl 8) or (b[at + 3].toLong() and 0xff)
}
