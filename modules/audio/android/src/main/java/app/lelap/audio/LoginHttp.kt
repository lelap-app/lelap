package app.lelap.audio

import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection

/**
 * One request for part of a file with a login over HTTP (M100). Its redirects are followed again
 * on every request, by [LoginRedirects]: the login goes along while the address stays on the
 * file's own server and is dropped once a redirect leaves it, so a signed link that changes
 * between requests never gets the login, and a server that moves the file on its own host still
 * does. Media3's own HTTP source sends the same headers to every host it is redirected to.
 */
object LoginHttp {
  const val TIMEOUT_MS = 15_000

  /** An answer: [status], the address it came from, and for a 2xx the bytes from the position asked. */
  class Answer(
    val connection: HttpURLConnection,
    val status: Int,
    val url: String,
    /** Bytes left to read from [stream]; -1 when the server didn't say. */
    val length: Long,
    val stream: InputStream?,
  )

  /** The Range header for [length] bytes from [position]; null for the whole file. [length] -1: to the end. */
  fun range(position: Long, length: Long): String? = when {
    position == 0L && length < 0L -> null
    length < 0L -> "bytes=$position-"
    else -> "bytes=$position-${position + length - 1}"
  }

  /** The bytes an answer carries, from its Content-Range or else its Content-Length; -1 when neither says. */
  fun contentLength(contentLength: String?, contentRange: String?): Long {
    val match = contentRange?.let { Regex("""bytes (\d+)-(\d+)/(?:\d+|\*)""").find(it.trim()) }
    if (match != null) {
      val (first, last) = match.destructured
      return last.toLong() - first.toLong() + 1
    }
    return contentLength?.trim()?.toLongOrNull()?.takeIf { it >= 0 } ?: -1L
  }

  /** The whole file's size, after the slash of a Content-Range; -1 when it doesn't say. */
  fun documentSize(contentRange: String?): Long =
    contentRange?.substringAfterLast('/', "")?.trim()?.toLongOrNull() ?: -1L

  /**
   * Asks for [length] bytes of [url] from [position] (-1: to the end). [login] goes only to the
   * file's own server; [headers] (Media3's own, such as for stream titles) to every hop. A server
   * that ignores the range and sends the whole file is read past the bytes before [position].
   */
  fun open(
    url: String,
    login: Map<String, String>,
    headers: Map<String, String>,
    position: Long,
    length: Long,
  ): Answer {
    val connection = LoginRedirects.open(url, login) { c ->
      c.connectTimeout = TIMEOUT_MS
      c.readTimeout = TIMEOUT_MS
      c.setRequestProperty("User-Agent", "Lelap")
      // Positions are bytes of the file itself, never of a compressed answer.
      c.setRequestProperty("Accept-Encoding", "identity")
      headers.forEach { (name, value) -> c.setRequestProperty(name, value) }
      range(position, length)?.let { c.setRequestProperty("Range", it) }
    }
    val status = connection.responseCode
    val at = connection.url.toString()
    if (status !in 200..299) return Answer(connection, status, at, -1L, null)
    val stream = connection.inputStream
    var left = contentLength(connection.getHeaderField("Content-Length"), connection.getHeaderField("Content-Range"))
    if (status == 200 && position > 0L) {
      skipFully(stream, position)
      if (left >= 0L) left = (left - position).coerceAtLeast(0L)
    }
    if (length >= 0L) left = if (left < 0L) length else minOf(left, length)
    return Answer(connection, status, at, left, stream)
  }

  private fun skipFully(stream: InputStream, count: Long) {
    var left = count
    val buffer = ByteArray(8192)
    while (left > 0L) {
      val read = stream.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
      if (read < 0) throw IOException("The file ended before the place asked for.")
      left -= read
    }
  }
}
