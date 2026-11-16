package app.lelap.library

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

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

  fun chap(version: Int, id: String, startMs: Long, endMs: Long, title: String?) = id3Frame(
    version,
    "CHAP",
    concat(
      id.toByteArray(Charsets.ISO_8859_1), byteArrayOf(0),
      u32(startMs), u32(endMs), u32(0xffffffffL), u32(0xffffffffL),
      title?.let { tit2(version, it) } ?: ByteArray(0),
    ),
  )

  fun id3(version: Int, vararg frames: ByteArray): ByteArray {
    val body = concat(*frames)
    return concat("ID3".toByteArray(), byteArrayOf(version.toByte(), 0, 0), synchsafe(body.size), body)
  }

  fun atom(type: String, vararg children: ByteArray): ByteArray {
    val body = concat(*children)
    return concat(u32(8L + body.size), type.toByteArray(Charsets.ISO_8859_1), body)
  }
}
