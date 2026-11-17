package app.lelap.updater

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ChecksumTest {
  private fun file(text: String) = File.createTempFile("apk", ".bin").apply {
    writeText(text)
    deleteOnExit()
  }

  @Test fun `hashes like sha256sum`() {
    assertEquals(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      Checksum.sha256(file("abc")),
    )
  }

  @Test fun `matches only the right hash and size`() {
    val apk = file("abc")
    val hash = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"
    assertTrue(Checksum.matches(apk, hash, 3))
    assertFalse(Checksum.matches(apk, hash, 4))
    assertFalse(Checksum.matches(apk, "0".repeat(64), 3))
    assertFalse(Checksum.matches(File("/nonexistent"), hash, 3))
  }

  @Test fun `copies up to the release size and refuses more`() {
    val bytes = ByteArray(200_000) { it.toByte() }
    val out = ByteArrayOutputStream()
    assertEquals(200_000L, Checksum.copyLimited(ByteArrayInputStream(bytes), out, 200_000))
    assertEquals(200_000, out.size())
    assertThrows(IOException::class.java) {
      Checksum.copyLimited(ByteArrayInputStream(bytes), ByteArrayOutputStream(), 199_999)
    }
  }
}
