package app.lelap.cast

import java.io.DataInputStream
import java.net.InetSocketAddress
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

  /** Blocks for up to a few seconds; never on main. */
  fun run(device: CastDevice, roots: List<X509Certificate> = CastRoots.all): CastAuth.Verdict = try {
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf(TrustDevice), SecureRandom())
    (context.socketFactory.createSocket() as SSLSocket).use { socket ->
      socket.connect(InetSocketAddress(device.host, device.port), TIMEOUT_MS)
      socket.soTimeout = TIMEOUT_MS
      socket.startHandshake()
      val peer = socket.session.peerCertificates.firstOrNull() as? X509Certificate
        ?: return CastAuth.Verdict.Untrusted("no TLS certificate")
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

  /** For logcat: words and numbers only, no device name or address. */
  fun describe(verdict: CastAuth.Verdict): String = when (verdict) {
    is CastAuth.Verdict.Trusted -> if (verdict.audioOnly) "trusted, audio only" else "trusted"
    is CastAuth.Verdict.Untrusted -> "untrusted: ${verdict.reason}"
  }
}
