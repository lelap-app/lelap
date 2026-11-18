package app.lelap.library

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Builders for small tag fixtures. */
object Bytes {
  fun synchsafe(n: Int) = byteArrayOf(
    ((n shr 21) and 0x7f).toByte(), ((n shr 14) and 0x7f).toByte(),
    ((n shr 7) and 0x7f).toByte(), (n and 0x7f).toByte(),
  )

  fun u32(n: Long) = ByteBuffer.allocate(4).putInt(n.toInt()).array()
  fun u64(n: Long) = ByteBuffer.allocate(8).putLong(n).array()
  fun u16(n: Int) = byteArrayOf(((n shr 8) and 0xff).toByte(), (n and 0xff).toByte())

  fun concat(vararg parts: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    parts.forEach { out.write(it) }
    return out.toByteArray()
  }

  fun id3Frame(version: Int, id: String, body: ByteArray): ByteArray = concat(
    id.toByteArray(Charsets.ISO_8859_1),
    if (version == 4) synchsafe(body.size) else u32(body.size.toLong()),
    byteArrayOf(0, 0),
    body,
  )

  fun tit2(version: Int, title: String) =
    id3Frame(version, "TIT2", concat(byteArrayOf(3), title.toByteArray(Charsets.UTF_8)))

  fun chap(version: Int, id: String, startMs: Long, endMs: Long, title: String?) =
    id3Frame(version, "CHAP", chapBody(id, startMs, endMs, title?.let { tit2(version, it) }))

  fun chapBody(id: String, startMs: Long, endMs: Long, subFrames: ByteArray?) = concat(
    id.toByteArray(Charsets.ISO_8859_1), byteArrayOf(0),
    u32(startMs), u32(endMs), u32(0xffffffffL), u32(0xffffffffL),
    subFrames ?: ByteArray(0),
  )

  fun txxxBody(description: String, value: String, encoding: Int = 3): ByteArray {
    val charset = if (encoding == 1) Charsets.UTF_16 else Charsets.UTF_8
    val terminator = if (encoding == 1) byteArrayOf(0, 0) else byteArrayOf(0)
    return concat(byteArrayOf(encoding.toByte()), description.toByteArray(charset), terminator, value.toByteArray(charset))
  }

  fun textBody(value: String) = concat(byteArrayOf(3), value.toByteArray(Charsets.UTF_8))

  /** ID3 unsynchronisation: a zero byte after every 0xFF. */
  fun unsync(bytes: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    for (b in bytes) {
      out.write(b.toInt())
      if (b == 0xff.toByte()) out.write(0)
    }
    return out.toByteArray()
  }

  /** A v2.4 frame flagged unsynchronised, with a data length indicator. */
  fun id3FrameUnsync(id: String, body: ByteArray): ByteArray {
    val stored = concat(synchsafe(body.size), unsync(body))
    return concat(id.toByteArray(Charsets.ISO_8859_1), synchsafe(stored.size), byteArrayOf(0, 0x03), stored)
  }

  /** A v2.4 frame whose size is a plain 32-bit number, as some taggers write it. */
  fun id3FramePlain(id: String, body: ByteArray): ByteArray =
    concat(id.toByteArray(Charsets.ISO_8859_1), u32(body.size.toLong()), byteArrayOf(0, 0), body)

  /** A v2.2 frame: a three-letter ID and a 3-byte size, no flags. */
  fun id3v22Frame(id: String, body: ByteArray): ByteArray = concat(
    id.toByteArray(Charsets.ISO_8859_1),
    byteArrayOf((body.size shr 16).toByte(), (body.size shr 8).toByte(), body.size.toByte()),
    body,
  )

  fun id3(version: Int, vararg frames: ByteArray, flags: Int = 0): ByteArray {
    val body = concat(*frames)
    return concat("ID3".toByteArray(), byteArrayOf(version.toByte(), 0, flags.toByte()), synchsafe(body.size), body)
  }

  /** A v2.2 or v2.3 tag unsynchronised as a whole; its size counts the stored bytes. */
  fun id3Unsynced(version: Int, vararg frames: ByteArray): ByteArray {
    val body = unsync(concat(*frames))
    return concat("ID3".toByteArray(), byteArrayOf(version.toByte(), 0, 0x80.toByte()), synchsafe(body.size), body)
  }

  fun le32(n: Int) = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(n).array()

  /** A Vorbis comment block: vendor, count, then `KEY=value` comments. */
  fun vorbisComments(vararg comments: String): ByteArray {
    val vendor = "example".toByteArray()
    return concat(
      le32(vendor.size),
      vendor,
      le32(comments.size),
      *comments.map { concat(le32(it.toByteArray().size), it.toByteArray()) }.toTypedArray(),
    )
  }

  /**
   * One Ogg logical stream holding [packets], with at most [segmentsPerPage] lacing values per
   * page, so a long packet spans pages. Checksums are left zero; the reader doesn't check them.
   */
  fun ogg(serial: Int, packets: List<ByteArray>, segmentsPerPage: Int = 255): ByteArray {
    val segments = mutableListOf<ByteArray>()
    for (packet in packets) {
      var at = 0
      while (packet.size - at >= 255) {
        segments += packet.copyOfRange(at, at + 255)
        at += 255
      }
      segments += packet.copyOfRange(at, packet.size)
    }
    val out = ByteArrayOutputStream()
    var continued = false
    segments.chunked(segmentsPerPage).forEachIndexed { sequence, page ->
      out.write(
        concat(
          "OggS".toByteArray(),
          byteArrayOf(0, if (continued) 1 else 0),
          ByteArray(8),
          le32(serial),
          le32(sequence),
          ByteArray(4),
          byteArrayOf(page.size.toByte()),
          ByteArray(page.size) { page[it].size.toByte() },
          *page.toTypedArray(),
        ),
      )
      continued = page.last().size == 255
    }
    return out.toByteArray()
  }

  fun atom(type: String, vararg children: ByteArray): ByteArray {
    val body = concat(*children)
    return concat(u32(8L + body.size), type.toByteArray(Charsets.ISO_8859_1), body)
  }
}
