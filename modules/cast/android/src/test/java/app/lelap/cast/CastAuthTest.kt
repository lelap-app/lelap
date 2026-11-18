package app.lelap.cast

import app.lelap.cast.CastAuth.bytesField
import app.lelap.cast.CastAuth.varintField
import java.io.ByteArrayOutputStream
import java.security.KeyFactory
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Date
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Fixtures in `resources/castauth`, made with openssl for these tests only: a root, an
 * intermediate and a device certificate under it, the device key, an unrelated root and a TLS
 * certificate. None of them is Google's.
 */
class CastAuthTest {
  private val nonce = ByteArray(16) { it.toByte() }

  // Inside every fixture's dates.
  private val now = Date(1_800_000_000_000L)

  private fun bytes(name: String): ByteArray = javaClass.getResourceAsStream("/castauth/$name")!!.use { it.readBytes() }

  private fun cert(name: String): X509Certificate =
    CertificateFactory.getInstance("X.509").generateCertificate(bytes(name).inputStream()) as X509Certificate

  private val root = cert("root.pem")
  private val otherRoot = cert("other-root.pem")
  private val intermediate = cert("intermediate.pem")
  private val device = cert("device.pem")
  private val peer = cert("peer.pem")

  private fun sign(data: ByteArray, algorithm: String = "SHA256withRSA"): ByteArray {
    val key = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(bytes("device.pk8")))
    return Signature.getInstance(algorithm).run {
      initSign(key)
      update(data)
      sign()
    }
  }

  private fun response(
    signature: ByteArray = sign(nonce + peer.encoded),
    senderNonce: ByteArray? = nonce,
    hash: Int = CastAuth.HASH_SHA256,
    intermediates: List<ByteArray> = listOf(intermediate.encoded),
  ) = CastAuth.Response(signature, device.encoded, intermediates, CastAuth.SIGNATURE_RSASSA_PKCS1V15, senderNonce, hash)

  @Test
  fun aChallengeIsADeviceAuthMessageWithPkcs1Sha256AndTheNonce() {
    val bytes = CastAuth.challenge(byteArrayOf(0x41, 0x42))
    // challenge (1) { signature_algorithm (1) = 1, sender_nonce (2) = "AB", hash_algorithm (3) = 1 }
    assertArrayEquals(byteArrayOf(0x0a, 0x08, 0x08, 0x01, 0x12, 0x02, 0x41, 0x42, 0x18, 0x01), bytes)
  }

  @Test
  fun parsesAnAnswer() {
    val r = response()
    val inner = ByteArrayOutputStream().apply {
      bytesField(1, r.signature)
      bytesField(2, r.deviceCertificate)
      bytesField(3, intermediate.encoded)
      varintField(4, 1)
      bytesField(5, nonce)
      varintField(6, 1)
      // crl (7): not checked, skipped.
      bytesField(7, byteArrayOf(1, 2, 3))
    }.toByteArray()
    val message = ByteArrayOutputStream().apply { bytesField(2, inner) }.toByteArray()
    val answer = CastAuth.parse(message) as CastAuth.Reply.Answer
    assertArrayEquals(r.signature, answer.response.signature)
    assertArrayEquals(device.encoded, answer.response.deviceCertificate)
    assertEquals(1, answer.response.intermediates.size)
    assertArrayEquals(nonce, answer.response.senderNonce)
    assertEquals(CastAuth.HASH_SHA256, answer.response.hashAlgorithm)
  }

  @Test
  fun anAnswerWithoutHashSaysSha1AsTheProtoDefault() {
    val inner = ByteArrayOutputStream().apply {
      bytesField(1, byteArrayOf(9))
      bytesField(2, byteArrayOf(8))
    }.toByteArray()
    val answer = CastAuth.parse(ByteArrayOutputStream().apply { bytesField(2, inner) }.toByteArray()) as CastAuth.Reply.Answer
    assertEquals(CastAuth.HASH_SHA1, answer.response.hashAlgorithm)
    assertNull(answer.response.senderNonce)
  }

  @Test
  fun parsesARefusalAndRejectsGarbage() {
    val error = ByteArrayOutputStream().apply { varintField(1, 2) }.toByteArray()
    val refused = CastAuth.parse(ByteArrayOutputStream().apply { bytesField(3, error) }.toByteArray())
    assertEquals(CastAuth.Reply.Refused(2), refused)
    // A length running past the end.
    assertNull(CastAuth.parse(byteArrayOf(0x12, 0x7f, 0x01)))
    // An answer missing its signature.
    val noSignature = ByteArrayOutputStream().apply { bytesField(2, byteArrayOf(0x12, 0x01, 0x00)) }.toByteArray()
    assertNull(CastAuth.parse(noSignature))
  }

  @Test
  fun aSignedAnswerChainedToARootIsTrusted() {
    assertEquals(CastAuth.Verdict.Trusted, CastAuth.verify(response(), nonce, peer, listOf(root), now))
  }

  @Test
  fun sha1SignaturesFromOlderReceiversAreChecked() {
    val r = response(signature = sign(nonce + peer.encoded, "SHA1withRSA"), hash = CastAuth.HASH_SHA1)
    assertEquals(CastAuth.Verdict.Trusted, CastAuth.verify(r, nonce, peer, listOf(root), now))
  }

  @Test
  fun withoutRootsAGoodSignatureProvesNothing() {
    assertTrue(CastAuth.verify(response(), nonce, peer, emptyList(), now) is CastAuth.Verdict.Unanchored)
  }

  @Test
  fun anotherRootOrAMissingIntermediateIsUntrusted() {
    assertEquals(CastAuth.Verdict.Untrusted("chain not trusted"), CastAuth.verify(response(), nonce, peer, listOf(otherRoot), now))
    assertEquals(
      CastAuth.Verdict.Untrusted("chain not trusted"),
      CastAuth.verify(response(intermediates = emptyList()), nonce, peer, listOf(root), now),
    )
  }

  @Test
  fun theAnswerMustBeForOurNonceAndThisConnection() {
    val other = ByteArray(16) { 7 }
    assertEquals(CastAuth.Verdict.Untrusted("another nonce"), CastAuth.verify(response(senderNonce = other), nonce, peer, listOf(root), now))
    assertEquals(CastAuth.Verdict.Untrusted("no nonce in the answer"), CastAuth.verify(response(senderNonce = null), nonce, peer, listOf(root), now))
    // Signed for another TLS certificate: a relayed answer from a real device.
    val relayed = response(signature = sign(nonce + root.encoded))
    assertEquals(CastAuth.Verdict.Untrusted("bad signature"), CastAuth.verify(relayed, nonce, peer, listOf(root), now))
    // Signed over another nonce but echoing ours.
    val replayed = response(signature = sign(other + peer.encoded))
    assertEquals(CastAuth.Verdict.Untrusted("bad signature"), CastAuth.verify(replayed, nonce, peer, listOf(root), now))
  }

  @Test
  fun aTamperedSignatureOrAnUnknownHashIsUntrusted() {
    val signature = sign(nonce + peer.encoded).also { it[10] = (it[10] + 1).toByte() }
    assertEquals(CastAuth.Verdict.Untrusted("bad signature"), CastAuth.verify(response(signature = signature), nonce, peer, listOf(root), now))
    assertEquals(CastAuth.Verdict.Untrusted("unsupported hash 5"), CastAuth.verify(response(hash = 5), nonce, peer, listOf(root), now))
  }

  @Test
  fun anExpiredTlsCertificateIsUntrusted() {
    val later = Date(peer.notAfter.time + 1_000L)
    assertEquals(CastAuth.Verdict.Untrusted("TLS certificate out of date"), CastAuth.verify(response(), nonce, peer, listOf(root), later))
  }
}
