package app.lelap.download

import app.lelap.text.NativeCatalog
import app.lelap.text.ShownException
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
  /**
   * Saves [url] as [name] in [folder]. [onBytes] gets the length of the part file so far; [text]
   * words the failures the listener sees.
   */
  suspend fun fetch(
    url: String,
    folder: BookFolder,
    name: String,
    expectedSize: Long,
    headers: Map<String, String> = emptyMap(),
    text: NativeCatalog = NativeCatalog.ENGLISH,
    integrity: String? = null,
    onBytes: suspend (Long) -> Unit,
  ) {
    val part = name + PART_SUFFIX
    var discarded = false
    var refreshed = false
    while (true) {
      val existing = folder.length(part) ?: 0L
      val connection = open(url, existing, headers, text)
      try {
        val code = connection.responseCode
        if (code in 200..299 && DownloadRules.isMessage(connection.contentType)) {
          throw PermanentFailure(text.t("The server sent a message instead of the file."))
        }
        when (DownloadRules.decide(code, existing, connection.getHeaderField("Content-Range"), expectedSize, refreshed)) {
          Resume.APPEND -> copy(connection, folder, part, append = true, start = existing, text, onBytes)
          Resume.RESTART -> copy(connection, folder, part, append = false, start = 0L, text, onBytes)
          Resume.COMPLETE -> Unit
          Resume.DISCARD -> {
            folder.delete(part)
            if (discarded) throw ShownException(text.t("The server does not continue downloads (HTTP {status}).", "status" to code))
            discarded = true
            continue
          }
          Resume.REFRESH -> {
            refreshed = true
            continue
          }
          Resume.RETRY -> throw ShownException(text.t("The server answered HTTP {status}.", "status" to code))
          Resume.FAIL -> throw PermanentFailure(text.t("The server answered HTTP {status}.", "status" to code))
        }
      } finally {
        connection.disconnect()
      }
      // Checked before it gets its name: a file under its own name counts as downloaded.
      if (integrity != null && Integrity.check(folder.input(part), integrity) == Integrity.Result.MISMATCH) {
        folder.delete(part)
        throw PermanentFailure(text.t("The file doesn’t match the checksum in the feed, so it was not kept. It may have changed on the way."))
      }
      folder.rename(part, name)
      return
    }
  }

  // Redirects by hand: HttpURLConnection does not follow them from http to https or back.
  private fun open(url: String, existing: Long, headers: Map<String, String>, text: NativeCatalog): HttpURLConnection {
    val origin = URL(url)
    var current = origin
    repeat(MAX_REDIRECTS) {
      if (current.protocol != "https" && current.protocol != "http") {
        throw PermanentFailure(text.t("Only web addresses can be downloaded."))
      }
      val c = current.openConnection() as HttpURLConnection
      c.instanceFollowRedirects = false
      c.connectTimeout = CONNECT_TIMEOUT_MS
      c.readTimeout = READ_TIMEOUT_MS
      c.setRequestProperty("User-Agent", "Lelap")
      c.setRequestProperty("Accept-Encoding", "identity")
      if (existing > 0) c.setRequestProperty("Range", "bytes=$existing-")
      // A login goes to the server it belongs to, never to a host a redirect points at.
      if (current.host == origin.host && current.protocol == origin.protocol) {
        headers.forEach { (name, value) -> c.setRequestProperty(name, value) }
      }
      val code = c.responseCode
      if (code in 300..399 && code != 304) {
        val location = c.getHeaderField("Location")
        c.disconnect()
        current = URL(current, location ?: throw PermanentFailure(text.t("The server answered HTTP {status} without an address to go to.", "status" to code)))
      } else {
        return c
      }
    }
    throw PermanentFailure(text.t("The server sent the download through too many addresses."))
  }

  private suspend fun copy(
    connection: HttpURLConnection,
    folder: BookFolder,
    part: String,
    append: Boolean,
    start: Long,
    text: NativeCatalog,
    onBytes: suspend (Long) -> Unit,
  ) {
    val length = connection.contentLengthLong
    var written = 0L
    connection.inputStream.use { input ->
      folder.output(part, append).use { output ->
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
    if (length >= 0 && written < length) throw ShownException(text.t("The connection closed early."))
  }
}
