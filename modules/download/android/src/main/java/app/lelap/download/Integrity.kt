package app.lelap.download

import java.io.InputStream
import java.security.MessageDigest
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * Subresource Integrity hashes (`sha256-…`), as `podcast:integrity` gives them (M103). The file is
 * read in small blocks, so a 100 MB episode never sits in memory.
 */
object Integrity {
  enum class Result { MATCH, MISMATCH, UNCHECKED }

  // Strongest first: SRI checks only the strongest algorithm a value names.
  private val ALGORITHMS = listOf("sha512" to "SHA-512", "sha384" to "SHA-384", "sha256" to "SHA-256")
  private const val BLOCK_BYTES = 64 * 1024

  /** The strongest algorithm in [sri] with its expected digests; null when none is known. */
  @OptIn(ExperimentalEncodingApi::class)
  fun expected(sri: String): Pair<String, List<ByteArray>>? {
    val tokens = sri.trim().split(Regex("\\s+")).mapNotNull { token ->
      val dash = token.indexOf('-')
      if (dash <= 0) return@mapNotNull null
      // Options after `?` are reserved by the spec and ignored.
      val digest = token.substring(dash + 1).substringBefore('?')
      val bytes = runCatching { Base64.Default.decode(digest) }.getOrNull() ?: return@mapNotNull null
      token.substring(0, dash).lowercase() to bytes
    }
    for ((name, algorithm) in ALGORITHMS) {
      val digests = tokens.filter { it.first == name }.map { it.second }
      if (digests.isNotEmpty()) return algorithm to digests
    }
    return null
  }

  /** Whether [input] hashes to one of [sri]'s digests; it is read to its end and closed. */
  fun check(input: InputStream, sri: String): Result {
    val (algorithm, digests) = expected(sri) ?: return Result.UNCHECKED
    val digest = MessageDigest.getInstance(algorithm)
    input.use {
      val buffer = ByteArray(BLOCK_BYTES)
      while (true) {
        val n = it.read(buffer)
        if (n < 0) break
        digest.update(buffer, 0, n)
      }
    }
    val actual = digest.digest()
    return if (digests.any { MessageDigest.isEqual(it, actual) }) Result.MATCH else Result.MISMATCH
  }
}
