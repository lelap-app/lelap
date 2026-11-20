package app.lelap.download

import app.lelap.text.NativeCatalog
import app.lelap.text.ShownException
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.delay
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
    onPreparing: suspend (seconds: Long) -> Unit = {},
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
        val retryAfter = connection.getHeaderField("Retry-After")
        when (DownloadRules.decide(code, existing, connection.getHeaderField("Content-Range"), expectedSize, refreshed, retryAfter)) {
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
          Resume.PREPARING -> {
            // No limit of its own: the source ends the wait with any other answer. WorkManager
            // stops this run when the Wi-Fi or charging rule no longer holds.
            val seconds = DownloadRules.retryAfterSeconds(retryAfter, System.currentTimeMillis()) ?: DownloadRules.RETRY_AFTER_MIN_S
            connection.disconnect()
            onPreparing(seconds)
            delay(seconds * 1000)
            continue
          }
          Resume.RETRY -> throw ShownException(text.t("The server answered HTTP {status}.", "status" to code))
          Resume.FAIL -> throw PermanentFailure(
            (if (code == 404 || code == 410) DownloadRules.endMessage(connection.contentType, errorBody(connection)) else null)
              ?: text.t("The server answered HTTP {status}.", "status" to code),
          )
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

  // A short reason from the server; never more than a few hundred bytes are read.
  private fun errorBody(connection: HttpURLConnection): String? = runCatching {
    connection.errorStream?.use { stream ->
      val buffer = ByteArray(DownloadRules.END_MESSAGE_MAX * 4 + 1)
      var read = 0
      while (read < buffer.size) {
        val n = stream.read(buffer, read, buffer.size - read)
        if (n < 0) break
        read += n
      }
      String(buffer, 0, read, Charsets.UTF_8)
    }
  }.getOrNull()

  // Redirects by hand: HttpURLConnection does not follow them from http to https or back. A Digest
  // login among the headers (M135) is answered on the file's own server instead of sent.
  private fun open(url: String, existing: Long, headers: Map<String, String>, text: NativeCatalog): HttpURLConnection {
    val (plain, digest) = HttpDigest.split(headers)
    val origin = URL(url)
    var current = origin
    var redirects = 0
    var answered = false
    while (true) {
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
      val own = current.host == origin.host && current.protocol == origin.protocol
      if (own) {
        plain.forEach { (name, value) -> c.setRequestProperty(name, value) }
        if (digest != null) HttpDigest.answer(current, digest, c.requestMethod)?.let { c.setRequestProperty("Authorization", it) }
      }
      val code = c.responseCode
      if (code == 401 && own && digest != null && !answered) {
        val challenge = HttpDigest.challenge(HttpDigest.challenges(c))
        if (challenge != null) {
          c.disconnect()
          HttpDigest.remember(current, digest, challenge)
          answered = true
          continue
        }
      }
      if (code in 300..399 && code != 304) {
        val location = c.getHeaderField("Location")
        c.disconnect()
        if (++redirects >= MAX_REDIRECTS) {
          throw PermanentFailure(text.t("The server sent the download through too many addresses."))
        }
        current = URL(current, location ?: throw PermanentFailure(text.t("The server answered HTTP {status} without an address to go to.", "status" to code)))
      } else {
        return c
      }
    }
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
