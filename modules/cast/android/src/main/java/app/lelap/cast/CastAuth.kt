package app.lelap.cast

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.security.Signature
import java.security.cert.CertPathValidator
import java.security.cert.CertificateFactory
import java.security.cert.PKIXParameters
import java.security.cert.TrustAnchor
import java.security.cert.X509Certificate
import java.util.Date

/**
 * Cast device authentication: the challenge a sender sends on namespace [NAMESPACE] and the check
 * of the receiver's answer, as `cast_channel.proto` and Chromium's `cast_auth_util` define them.
 *
 * What [verify] checks, in order:
 * 1. The answer carries our nonce, so it was made for this challenge.
 * 2. The TLS certificate the receiver showed on this connection is within its dates.
 * 3. The signature (RSASSA-PKCS1-v1_5 with SHA-256 or SHA-1) over the nonce and that TLS
 *    certificate verifies with the key of the device certificate in the answer. This ties the TLS
 *    connection to the device certificate's private key.
 * 4. The device certificate is within its dates.
 * 5. The device certificate and its intermediates chain up to one of [roots] (PKIX, no revocation).
 *
 * Without 5 nothing is proven: anyone can make a certificate and sign with it. Google's Cast root
 * certificates are not bundled yet, so [verify] answers [Verdict.Unanchored] at best. Not checked
 * at all: Google's revocation list (the answer's `crl`), RSASSA-PSS, and the device certificate's
 * policies (audio-only devices), which Chromium uses to limit what a device may play.
 */
object CastAuth {
  const val NAMESPACE = "urn:x-cast:com.google.cast.tp.deviceauth"

  // cast_channel.proto enums.
  const val SIGNATURE_RSASSA_PKCS1V15 = 1
  const val SIGNATURE_RSASSA_PSS = 2
  const val HASH_SHA1 = 0
  const val HASH_SHA256 = 1

  data class Response(
    val signature: ByteArray,
    val deviceCertificate: ByteArray,
    val intermediates: List<ByteArray>,
    val signatureAlgorithm: Int,
    val senderNonce: ByteArray?,
    val hashAlgorithm: Int,
  )

  sealed interface Reply {
    data class Answer(val response: Response) : Reply

    /** The receiver refused: `AuthError.error_type`, 0 internal error, 1 no TLS, 2 unsupported signature. */
    data class Refused(val errorType: Int) : Reply
  }

  sealed interface Verdict {
    /** Every check passed, the chain included. */
    data object Trusted : Verdict

    /** The signature checks out, but there is no root to anchor the chain to. Proves nothing. */
    data class Unanchored(val reason: String) : Verdict

    data class Untrusted(val reason: String) : Verdict
  }

  /** A `DeviceAuthMessage` with an `AuthChallenge`: PKCS#1 v1.5 signature, SHA-256, our nonce. */
  fun challenge(nonce: ByteArray): ByteArray {
    val challenge = ByteArrayOutputStream().apply {
      varintField(1, SIGNATURE_RSASSA_PKCS1V15.toLong())
      bytesField(2, nonce)
      varintField(3, HASH_SHA256.toLong())
    }.toByteArray()
    return ByteArrayOutputStream().apply { bytesField(1, challenge) }.toByteArray()
  }

  /** The receiver's `DeviceAuthMessage`, or null when it is neither an answer nor a refusal. */
  fun parse(bytes: ByteArray): Reply? = try {
    var response: ByteArray? = null
    var error: ByteArray? = null
    forEachField(bytes) { field, value ->
      when (field) {
        2 -> response = value as? ByteArray
        3 -> error = value as? ByteArray
      }
    }
    response?.let(::parseResponse)?.let(Reply::Answer)
      ?: error?.let { e ->
        var type = 0
        forEachField(e) { field, value -> if (field == 1 && value is Long) type = value.toInt() }
        Reply.Refused(type)
      }
  } catch (e: IOException) {
    null
  }

  private fun parseResponse(bytes: ByteArray): Response? {
    var signature: ByteArray? = null
    var device: ByteArray? = null
    val intermediates = mutableListOf<ByteArray>()
    var signatureAlgorithm = SIGNATURE_RSASSA_PKCS1V15
    var nonce: ByteArray? = null
    var hash = HASH_SHA1
    forEachField(bytes) { field, value ->
      when (field) {
        1 -> signature = value as? ByteArray
        2 -> device = value as? ByteArray
        3 -> (value as? ByteArray)?.let(intermediates::add)
        4 -> (value as? Long)?.let { signatureAlgorithm = it.toInt() }
        5 -> nonce = value as? ByteArray
        6 -> (value as? Long)?.let { hash = it.toInt() }
      }
    }
    return Response(signature ?: return null, device ?: return null, intermediates, signatureAlgorithm, nonce, hash)
  }

  /** Checks [response] to our [nonce] on the connection that showed [peerCertificate]; see the class. */
  fun verify(
    response: Response,
    nonce: ByteArray,
    peerCertificate: X509Certificate,
    roots: List<X509Certificate>,
    now: Date = Date(),
  ): Verdict {
    val echoed = response.senderNonce ?: return Verdict.Untrusted("no nonce in the answer")
    if (!MessageDigest.isEqual(echoed, nonce)) return Verdict.Untrusted("another nonce")
    if (!withinDates(peerCertificate, now)) return Verdict.Untrusted("TLS certificate out of date")
    if (response.signatureAlgorithm != SIGNATURE_RSASSA_PKCS1V15 && response.signatureAlgorithm != 0) {
      return Verdict.Untrusted("unsupported signature algorithm ${response.signatureAlgorithm}")
    }
    val algorithm = when (response.hashAlgorithm) {
      HASH_SHA256 -> "SHA256withRSA"
      HASH_SHA1 -> "SHA1withRSA"
      else -> return Verdict.Untrusted("unsupported hash ${response.hashAlgorithm}")
    }
    val factory = CertificateFactory.getInstance("X.509")
    val chain = try {
      (listOf(response.deviceCertificate) + response.intermediates).map {
        factory.generateCertificate(ByteArrayInputStream(it)) as X509Certificate
      }
    } catch (e: Exception) {
      return Verdict.Untrusted("unreadable certificate")
    }
    val device = chain.first()
    val signed = try {
      Signature.getInstance(algorithm).run {
        initVerify(device.publicKey)
        update(nonce)
        update(peerCertificate.encoded)
        verify(response.signature)
      }
    } catch (e: Exception) {
      false
    }
    if (!signed) return Verdict.Untrusted("bad signature")
    if (!withinDates(device, now)) return Verdict.Untrusted("device certificate out of date")
    if (roots.isEmpty()) return Verdict.Unanchored("no Cast root certificates")
    return try {
      val params = PKIXParameters(roots.map { TrustAnchor(it, null) }.toSet()).apply {
        isRevocationEnabled = false
        date = now
      }
      CertPathValidator.getInstance("PKIX").validate(factory.generateCertPath(chain), params)
      Verdict.Trusted
    } catch (e: Exception) {
      Verdict.Untrusted("chain not trusted")
    }
  }

  private fun withinDates(certificate: X509Certificate, now: Date): Boolean =
    runCatching { certificate.checkValidity(now) }.isSuccess

  /** Calls [visit] with each field: a Long for varints, a ByteArray for length-delimited ones. */
  private fun forEachField(bytes: ByteArray, visit: (Int, Any) -> Unit) {
    var i = 0
    fun varint(): Long {
      var result = 0L
      var shift = 0
      while (true) {
        if (i >= bytes.size || shift > 63) throw IOException("Truncated varint")
        val b = bytes[i++].toInt() and 0xff
        result = result or ((b and 0x7f).toLong() shl shift)
        if (b and 0x80 == 0) return result
        shift += 7
      }
    }
    while (i < bytes.size) {
      val key = varint()
      val field = (key ushr 3).toInt()
      when ((key and 7).toInt()) {
        0 -> visit(field, varint())
        1 -> i += 8
        5 -> i += 4
        2 -> {
          val length = varint()
          if (length < 0 || i + length > bytes.size) throw IOException("Truncated field")
          visit(field, bytes.copyOfRange(i, i + length.toInt()))
          i += length.toInt()
        }
        else -> throw IOException("Unknown wire type")
      }
      if (i > bytes.size) throw IOException("Truncated field")
    }
  }

  private fun ByteArrayOutputStream.varint(value: Long) {
    var v = value
    while (true) {
      if (v and 0x7fL.inv() == 0L) {
        write(v.toInt())
        return
      }
      write(((v and 0x7f) or 0x80).toInt())
      v = v ushr 7
    }
  }

  internal fun ByteArrayOutputStream.varintField(field: Int, value: Long) {
    varint((field shl 3).toLong())
    varint(value)
  }

  internal fun ByteArrayOutputStream.bytesField(field: Int, value: ByteArray) {
    varint(((field shl 3) or 2).toLong())
    varint(value.size.toLong())
    write(value)
  }
}
