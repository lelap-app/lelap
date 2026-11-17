package app.lelap.library

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

private const val BLOCK = 64 * 1024

/**
 * Random access to a file on a server through HTTP Range requests, read in 64 KB blocks so the
 * chapter parsers' many small reads cost few requests.
 */
class RemoteBytes(private val url: String, private val headers: Map<String, String>) {
  private val blocks = HashMap<Long, ByteArray>()

  /** The file's length, from the `Content-Range` of a one-byte request. */
  val size: Long by lazy {
    val c = open(0, 0)
    try {
      Ranges.total(c.getHeaderField("Content-Range")) ?: c.contentLengthLong.takeIf { it >= 0 }
        ?: throw IOException("No length")
    } finally {
      c.disconnect()
    }
  }

  fun read(offset: Long, length: Int): ByteArray {
    val out = ByteArray(length)
    var done = 0
    while (done < length) {
      val position = offset + done
      if (position >= size) break
      val index = position / BLOCK
      val block = blocks.getOrPut(index) { fetch(index * BLOCK, BLOCK) }
      val start = (position - index * BLOCK).toInt()
      if (start >= block.size) break
      val n = minOf(length - done, block.size - start)
      System.arraycopy(block, start, out, done, n)
      done += n
    }
    return out.copyOf(done)
  }

  private fun fetch(from: Long, length: Int): ByteArray {
    val c = open(from, from + length - 1)
    try {
      if (c.responseCode != 206) throw IOException("The server does not read ranges (HTTP ${c.responseCode})")
      return c.inputStream.use { it.readBytes() }
    } finally {
      c.disconnect()
    }
  }

  private fun open(from: Long, to: Long): HttpURLConnection {
    val c = URL(url).openConnection() as HttpURLConnection
    c.connectTimeout = 20_000
    c.readTimeout = 30_000
    c.setRequestProperty("Range", "bytes=$from-$to")
    c.setRequestProperty("Accept-Encoding", "identity")
    headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
    return c
  }
}

object Ranges {
  private val CONTENT_RANGE = Regex("""^bytes\s+\d+-\d+/(\d+)$""")

  /** The total from `bytes 0-0/12345`. */
  fun total(header: String?): Long? = header?.trim()?.let { CONTENT_RANGE.matchEntire(it) }?.groupValues?.get(1)?.toLongOrNull()
}
