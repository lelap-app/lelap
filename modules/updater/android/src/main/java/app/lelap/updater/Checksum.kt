package app.lelap.updater

import java.io.File
import java.security.MessageDigest

/** SHA-256 checks for downloaded APKs. Pure, so it is tested on the JVM. */
object Checksum {
  fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  fun matches(file: File, expected: String, size: Long): Boolean =
    file.isFile && file.length() == size && sha256(file).equals(expected, ignoreCase = true)
}
