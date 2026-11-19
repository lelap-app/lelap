package app.lelap.download

import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IntegrityTest {
  // `printf 'hello' | openssl dgst -sha256 -binary | base64`, and the same for SHA-384.
  private val hello = "hello".toByteArray()
  private val sha256 = "sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ="
  private val sha384 = "sha384-WeF0h3dEjGnea4ANejO7+5/xtGPkQ1TDVTvNucZm+pASWjx5+QOXvfX2oT3oKGhP"

  private fun check(bytes: ByteArray, sri: String) = Integrity.check(ByteArrayInputStream(bytes), sri)

  @Test fun `a file that hashes to the feed's value matches`() {
    assertEquals(Integrity.Result.MATCH, check(hello, sha256))
    assertEquals(Integrity.Result.MATCH, check(hello, sha384))
  }

  @Test fun `a changed file does not`() {
    assertEquals(Integrity.Result.MISMATCH, check("hellO".toByteArray(), sha256))
  }

  @Test fun `only the strongest algorithm counts, and any of its values`() {
    // A wrong SHA-256 next to a right SHA-384: the SHA-384 decides.
    assertEquals(Integrity.Result.MATCH, check(hello, "sha256-AAAA $sha384"))
    assertEquals(Integrity.Result.MISMATCH, check(hello, "$sha256 sha384-AAAA"))
    assertEquals(Integrity.Result.MATCH, check(hello, "sha384-AAAA $sha384"))
    // Options after `?` are ignored.
    assertEquals(Integrity.Result.MATCH, check(hello, "$sha256?ct=audio/mpeg"))
  }

  @Test fun `values it can't read are not checked`() {
    assertEquals(Integrity.Result.UNCHECKED, check(hello, "md5-XUFAKrxLKna5cZ2REBfFkg=="))
    assertEquals(Integrity.Result.UNCHECKED, check(hello, "not a hash"))
    assertNull(Integrity.expected(""))
  }

  @Test fun `reads a file bigger than its block in pieces`() {
    val big = ByteArray(200_000) { (it % 251).toByte() }
    val sri = "sha256-" + Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(big))
    assertEquals(Integrity.Result.MATCH, check(big, sri))
  }
}
