package app.lelap.download

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/** The server refused for good; retrying will not help. */
class PermanentFailure(message: String) : Exception(message)

private const val MAX_REDIRECTS = 8
private const val CONNECT_TIMEOUT_MS = 30_000
private const val READ_TIMEOUT_MS = 60_000
private const val BUFFER_BYTES = 64 * 1024

/** Downloads one file over HTTP, continuing a `.part` file left by an earlier run. */
object Http {
  /** [onBytes] gets the length of the part file so far. */
  suspend fun fetch(url: String, target: File, expectedSize: Long, onBytes: suspend (Long) -> Unit) {
    val part = File(target.parentFile, target.name + PART_SUFFIX)
    var discarded = false
    while (true) {
      val existing = if (part.isFile) part.length() else 0L
      val connection = open(url, existing)
      try {
        val code = connection.responseCode
        when (DownloadRules.decide(code, existing, connection.getHeaderField("Content-Range"), expectedSize)) {
          Resume.APPEND -> copy(connection, part, append = true, start = existing, onBytes)
          Resume.RESTART -> copy(connection, part, append = false, start = 0L, onBytes)
          Resume.COMPLETE -> Unit
          Resume.DISCARD -> {
            part.delete()
            if (discarded) throw IOException("The server does not continue downloads (HTTP $code).")
            discarded = true
            continue
          }
          Resume.RETRY -> throw IOException("HTTP $code")
          Resume.FAIL -> throw PermanentFailure("The server answered HTTP $code.")
        }
      } finally {
        connection.disconnect()
      }
      if (!part.renameTo(target)) throw IOException("Could not save ${target.name}.")
      return
    }
  }

  // Redirects by hand: HttpURLConnection does not follow them from http to https or back.
  private fun open(url: String, existing: Long): HttpURLConnection {
    var current = URL(url)
    repeat(MAX_REDIRECTS) {
      if (current.protocol != "https" && current.protocol != "http") {
        throw PermanentFailure("Only web addresses can be downloaded.")
      }
      val c = current.openConnection() as HttpURLConnection
      c.instanceFollowRedirects = false
      c.connectTimeout = CONNECT_TIMEOUT_MS
      c.readTimeout = READ_TIMEOUT_MS
      c.setRequestProperty("User-Agent", "Lelap")
      c.setRequestProperty("Accept-Encoding", "identity")
      if (existing > 0) c.setRequestProperty("Range", "bytes=$existing-")
      val code = c.responseCode
      if (code in 300..399 && code != 304) {
        val location = c.getHeaderField("Location")
        c.disconnect()
        current = URL(current, location ?: throw PermanentFailure("HTTP $code without a location."))
      } else {
        return c
      }
    }
    throw PermanentFailure("Too many redirects.")
  }

  private suspend fun copy(
    connection: HttpURLConnection,
    part: File,
    append: Boolean,
    start: Long,
    onBytes: suspend (Long) -> Unit,
  ) {
    val length = connection.contentLengthLong
    var written = 0L
    connection.inputStream.use { input ->
      FileOutputStream(part, append).use { output ->
        val buffer = ByteArray(BUFFER_BYTES)
        while (true) {
          coroutineContext.ensureActive()
          val n = input.read(buffer)
          if (n < 0) break
          output.write(buffer, 0, n)
          written += n
          onBytes(start + written)
        }
      }
    }
    // A cut connection can look like a normal end; the next run continues from here.
    if (length >= 0 && written < length) throw IOException("The connection closed early.")
  }
}
