package app.lelap.cast

import java.io.DataInputStream
import java.net.InetSocketAddress
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket

/**
 * Runs device authentication against a Cast receiver on a connection of its own, so a receiver
 * that dislikes the challenge can't end the session that plays. [CastLink] waits for the verdict
 * and connects only to a trusted receiver, unless the listener chose “Connect anyway” (M78).
 */
object CastAuthProbe {
  private const val TIMEOUT_MS = 5_000

  /** Connect, handshake, the answer's deadline and a read begun just before it: [TIMEOUT_MS] each. */
  const val LONGEST_MS = 4L * TIMEOUT_MS

  /** The verdict, and the TLS certificate of the connection it was reached on. */
  class Outcome(val verdict: CastAuth.Verdict, val peerCertificate: ByteArray?)

  /** Blocks for up to [LONGEST_MS]; never on main. */
  fun run(device: CastDevice, roots: List<X509Certificate> = CastRoots.all): Outcome {
    var peer: X509Certificate? = null
    val verdict = verdict(device, roots) { peer = it }
    return Outcome(verdict, runCatching { peer?.encoded }.getOrNull())
  }

  private fun verdict(device: CastDevice, roots: List<X509Certificate>, showed: (X509Certificate) -> Unit): CastAuth.Verdict = try {
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf(TrustDevice), SecureRandom())
    (context.socketFactory.createSocket() as SSLSocket).use { socket ->
      socket.connect(InetSocketAddress(device.host, device.port), TIMEOUT_MS)
      socket.soTimeout = TIMEOUT_MS
      socket.startHandshake()
      val peer = socket.session.peerCertificates.firstOrNull() as? X509Certificate
        ?: return CastAuth.Verdict.Untrusted("no TLS certificate")
      showed(peer)
      val nonce = ByteArray(16).also(SecureRandom()::nextBytes)
      val challenge = CastMessage("sender-0", "receiver-0", CastAuth.NAMESPACE, "", CastAuth.challenge(nonce))
      socket.outputStream.apply {
        write(CastMessage.frame(challenge))
        flush()
      }
      val input = DataInputStream(socket.inputStream)
      val deadline = System.currentTimeMillis() + TIMEOUT_MS
      while (System.currentTimeMillis() < deadline) {
        // A read past soTimeout throws, which ends the probe as "no answer".
        val message = CastMessage.read(input)
        if (message.namespace != CastAuth.NAMESPACE) continue
        val binary = message.binary ?: continue
        return when (val reply = CastAuth.parse(binary)) {
          is CastAuth.Reply.Answer -> CastAuth.verify(reply.response, nonce, peer, roots)
          is CastAuth.Reply.Refused -> CastAuth.Verdict.Untrusted("refused, error ${reply.errorType}")
          null -> CastAuth.Verdict.Untrusted("unreadable answer")
        }
      }
      CastAuth.Verdict.Untrusted("no answer")
    }
  } catch (e: Exception) {
    CastAuth.Verdict.Untrusted("no answer")
  }

  /**
   * The probe proves only the connection it ran on. The session's own connection must show the
   * same TLS certificate, or something on the network could pass the probe on to a real device
   * and answer the session itself.
   */
  fun forSession(outcome: Outcome, sessionCertificate: ByteArray?): CastAuth.Verdict {
    val verdict = outcome.verdict
    if (verdict !is CastAuth.Verdict.Trusted) return verdict
    val probed = outcome.peerCertificate
    if (probed == null || sessionCertificate == null || !MessageDigest.isEqual(probed, sessionCertificate)) {
      return CastAuth.Verdict.Untrusted("another TLS certificate on the session")
    }
    return verdict
  }

  /** For logcat: words and numbers only, no device name or address. */
  fun describe(verdict: CastAuth.Verdict): String = when (verdict) {
    is CastAuth.Verdict.Trusted -> if (verdict.audioOnly) "trusted, audio only" else "trusted"
    is CastAuth.Verdict.Untrusted -> "untrusted: ${verdict.reason}"
  }
}
