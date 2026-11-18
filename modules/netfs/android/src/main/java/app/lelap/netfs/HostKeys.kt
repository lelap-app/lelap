package app.lelap.netfs

import java.security.MessageDigest
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * SFTP host keys, trusted on first use: the app shows the key's fingerprint when a server is
 * added and stores it; every later connection must present the same key.
 */
object HostKeys {
  enum class Verdict { TRUSTED, CHANGED, NOT_TRUSTED_YET }

  /** OpenSSH's form, as `ssh-keygen -l` prints it: `SHA256:` and unpadded base64 of the key blob. */
  // Kotlin's base64: java.util.Base64 needs Android 8.
  @OptIn(ExperimentalEncodingApi::class)
  fun fingerprint(blob: ByteArray): String =
    "SHA256:" + Base64.Default.encode(MessageDigest.getInstance("SHA-256").digest(blob)).trimEnd('=')

  /**
   * [trusted] is what the app stored; null or empty while a server is being added, when nothing
   * is trusted yet and nothing may be sent but the question for the key.
   */
  fun check(trusted: String?, presented: String): Verdict = when {
    trusted.isNullOrBlank() -> Verdict.NOT_TRUSTED_YET
    // Compared in constant time; base64 is case-sensitive, the prefix is not.
    MessageDigest.isEqual(normalise(trusted).toByteArray(), normalise(presented).toByteArray()) -> Verdict.TRUSTED
    else -> Verdict.CHANGED
  }

  private fun normalise(fingerprint: String): String {
    val trimmed = fingerprint.trim()
    return if (trimmed.startsWith("sha256:", ignoreCase = true)) "SHA256:" + trimmed.substring(7).trimEnd('=') else trimmed
  }
}
