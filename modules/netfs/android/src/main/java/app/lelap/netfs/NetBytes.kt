package app.lelap.netfs

import java.io.InputStream

private const val BLOCK = 64 * 1024
private const val MAX_BLOCKS = 64

/**
 * Random access to a file on a server in 64 KB blocks, so the tag and chapter parsers' many
 * small reads cost few round trips. Keeps at most 4 MB.
 */
class NetBytes(private val file: NetFile) {
  val size: Long get() = file.length

  private val blocks = object : LinkedHashMap<Long, ByteArray>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Long, ByteArray>?) = size > MAX_BLOCKS
  }

  @Synchronized
  fun read(offset: Long, length: Int): ByteArray {
    require(offset >= 0 && length >= 0)
    val out = ByteArray(minOf(length.toLong(), maxOf(0L, size - offset)).toInt())
    var done = 0
    while (done < out.size) {
      val position = offset + done
      val index = position / BLOCK
      val block = blocks.getOrPut(index) { fetch(index * BLOCK) }
      val start = (position - index * BLOCK).toInt()
      if (start >= block.size) break
      val n = minOf(out.size - done, block.size - start)
      System.arraycopy(block, start, out, done, n)
      done += n
    }
    return if (done == out.size) out else out.copyOf(done)
  }

  private fun fetch(from: Long): ByteArray {
    val want = minOf(BLOCK.toLong(), size - from).toInt()
    val buffer = ByteArray(want)
    var got = 0
    while (got < want) {
      val n = file.read(from + got, buffer, got, want - got)
      if (n <= 0) break
      got += n
    }
    return if (got == want) buffer else buffer.copyOf(got)
  }
}

/** A stream over [file] from [start]; closing it closes nothing else (the caller owns the file). */
class NetInputStream(private val file: NetFile, start: Long) : InputStream() {
  private var position = start

  override fun read(): Int {
    val one = ByteArray(1)
    return if (read(one, 0, 1) <= 0) -1 else one[0].toInt() and 0xff
  }

  override fun read(b: ByteArray, off: Int, len: Int): Int {
    if (len == 0) return 0
    if (position >= file.length) return -1
    val n = file.read(position, b, off, minOf(len.toLong(), file.length - position).toInt())
    if (n > 0) position += n
    return n
  }

  override fun skip(n: Long): Long {
    val skipped = minOf(maxOf(0L, n), maxOf(0L, file.length - position))
    position += skipped
    return skipped
  }

  override fun available(): Int = minOf(Int.MAX_VALUE.toLong(), maxOf(0L, file.length - position)).toInt()
}

/**
 * Reads ahead in 256 KB chunks for the player: Media3's extractors ask for a few hundred bytes at
 * a time, and each read on SMB or SFTP is a round trip, so small reads come from the buffer.
 */
class ReadAhead(private val file: NetFile, private val bufferSize: Int = BUFFER) {
  private val buffer = ByteArray(bufferSize)
  private var start = 0L
  private var filled = 0

  fun read(position: Long, out: ByteArray, offset: Int, length: Int): Int {
    if (position >= file.length) return -1
    if (position < start || position >= start + filled) {
      val n = file.read(position, buffer, 0, minOf(bufferSize.toLong(), file.length - position).toInt())
      if (n <= 0) return -1
      start = position
      filled = n
    }
    val from = (position - start).toInt()
    val n = minOf(length, filled - from)
    System.arraycopy(buffer, from, out, offset, n)
    return n
  }

  companion object {
    const val BUFFER = 256 * 1024
  }
}
