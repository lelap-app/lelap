package app.lelap.library

import java.io.File
import java.io.IOException

/** Saves a small file from a server, such as a cover, with the server's login (M135). */
object RemoteFile {
  private const val MAX_BYTES = 32L * 1024 * 1024

  fun save(url: String, headers: Map<String, String>, target: File) {
    val c = LoginRedirects.open(url, headers) {
      it.connectTimeout = 20_000
      it.readTimeout = 30_000
    }
    try {
      if (c.responseCode !in 200..299) throw IOException("The server answered HTTP ${c.responseCode}.")
      if (c.contentLengthLong > MAX_BYTES) throw IOException("The file is too large.")
      c.inputStream.use { input ->
        target.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            total += n
            if (total > MAX_BYTES) throw IOException("The file is too large.")
            output.write(buffer, 0, n)
          }
        }
      }
    } catch (e: IOException) {
      target.delete()
      throw e
    } finally {
      c.disconnect()
    }
  }
}
