package app.lelap.netfs

import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.PublicKey
import java.security.Security
import java.util.EnumSet
import java.util.concurrent.TimeoutException
import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.KeyType
import net.schmizz.sshj.sftp.FileAttributes
import net.schmizz.sshj.sftp.FileMode
import net.schmizz.sshj.sftp.OpenMode
import net.schmizz.sshj.sftp.Response
import net.schmizz.sshj.sftp.SFTPClient
import net.schmizz.sshj.sftp.SFTPException
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import net.schmizz.sshj.userauth.method.AuthKeyboardInteractive
import net.schmizz.sshj.userauth.method.AuthPassword
import net.schmizz.sshj.userauth.method.AuthPublickey
import net.schmizz.sshj.userauth.method.PasswordResponseProvider
import net.schmizz.sshj.userauth.password.PasswordUtils
import org.bouncycastle.jce.provider.BouncyCastleProvider

/** A folder on a server over SSH, with sshj. The host key must be the one trusted when it was added. */
class SftpSession private constructor(private val ssh: SSHClient, private val sftp: SFTPClient) : NetSession {
  override val alive: Boolean
    get() = ssh.isConnected && ssh.isAuthenticated

  private fun entry(name: String, attributes: FileAttributes) = NetEntry(
    name = name,
    folder = attributes.type == FileMode.Type.DIRECTORY,
    size = attributes.size,
    modifiedAt = attributes.mtime * 1000,
    link = attributes.type == FileMode.Type.SYMLINK,
  )

  override fun list(path: String): List<NetEntry> = guard {
    sftp.ls(path.ifEmpty { "/" }).map { entry(it.name, it.attributes) }
  }

  override fun stat(path: String): NetEntry = guard { entry(path.substringAfterLast('/'), sftp.stat(path)) }

  override fun open(path: String): NetFile = guard {
    val file = sftp.open(path, EnumSet.of(OpenMode.READ))
    try {
      val length = file.length()
      object : NetFile {
        override val length = length
        override fun read(position: Long, buffer: ByteArray, offset: Int, length: Int): Int = guard {
          if (position >= this.length) -1 else file.read(position, buffer, offset, length)
        }
        override fun close() = file.close()
      }
    } catch (e: Exception) {
      runCatching { file.close() }
      throw e
    }
  }

  override fun close() {
    runCatching { sftp.close() }
    runCatching { ssh.disconnect() }
    runCatching { ssh.close() }
  }

  /** Remembers what the server showed, so a refusal can say why. */
  private class Verifier(private val trusted: String?) : HostKeyVerifier {
    @Volatile var presented: String? = null
    @Volatile var algorithm: String? = null
    @Volatile var verdict: HostKeys.Verdict? = null

    override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
      val fingerprint = HostKeys.fingerprint(Buffer.PlainBuffer().putPublicKey(key).compactData)
      presented = fingerprint
      algorithm = KeyType.fromKey(key).toString()
      val v = HostKeys.check(trusted, fingerprint)
      verdict = v
      return v == HostKeys.Verdict.TRUSTED
    }

    override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = emptyList()
  }

  data class HostKey(val fingerprint: String, val algorithm: String)

  companion object {
    private const val TIMEOUT_MS = 30_000

    /**
     * Android has a cut-down provider named "BC" that lacks what sshj needs (X25519, Ed25519);
     * the full one takes its name. Added last, so TLS and the rest of the app keep theirs.
     */
    @Synchronized
    fun useBouncyCastle() {
      if (Security.getProvider("BC")?.javaClass == BouncyCastleProvider::class.java) return
      Security.removeProvider("BC")
      Security.addProvider(BouncyCastleProvider())
    }

    private fun client(verifier: HostKeyVerifier): SSHClient {
      useBouncyCastle()
      return SSHClient(DefaultConfig()).apply {
        connectTimeout = TIMEOUT_MS
        timeout = TIMEOUT_MS
        addHostKeyVerifier(verifier)
      }
    }

    /**
     * The server's key, for the listener to compare before anything else is sent: the handshake
     * stops at the key, so no login reaches a server that is not yet trusted.
     */
    fun hostKey(address: NetAddress): HostKey {
      val verifier = Verifier(null)
      val ssh = client(verifier)
      try {
        ssh.connect(address.host, address.port)
      } catch (e: Exception) {
        val fingerprint = verifier.presented ?: throw classify(e, verifier)
        return HostKey(fingerprint, verifier.algorithm.orEmpty())
      } finally {
        runCatching { ssh.disconnect() }
        runCatching { ssh.close() }
      }
      throw NetFailure(NetFailure.Kind.UNREACHABLE, "The server did not show its host key.")
    }

    fun connect(address: NetAddress, login: NetLogin): SftpSession {
      if (login.hostKey.isNullOrBlank()) {
        throw NetFailure(NetFailure.Kind.HOST_KEY_UNKNOWN, "The server’s host key is not trusted yet.")
      }
      val verifier = Verifier(login.hostKey)
      val ssh = client(verifier)
      try {
        ssh.connect(address.host, address.port)
        val methods = buildList {
          login.privateKey?.let { key ->
            val provider = try {
              ssh.loadKeys(key, null, login.passphrase?.let { PasswordUtils.createOneOff(it.toCharArray()) })
                .also { it.private } // Decrypts now, so a wrong passphrase is told apart from a refusal.
            } catch (e: Exception) {
              throw NetFailure(NetFailure.Kind.PRIVATE_KEY, "The private key can’t be read. Check its passphrase.", e)
            }
            add(AuthPublickey(provider))
          }
          login.password?.let { password ->
            add(AuthPassword(PasswordUtils.createOneOff(password.toCharArray())))
            // Servers that turn passwords off often take the same one as keyboard-interactive.
            add(AuthKeyboardInteractive(PasswordResponseProvider(PasswordUtils.createOneOff(password.toCharArray()))))
          }
        }
        if (methods.isEmpty()) throw NetFailure(NetFailure.Kind.LOGIN, "Enter a password or a private key.")
        ssh.auth(login.user, methods)
        val sftp = ssh.newSFTPClient()
        sftp.sftpEngine.timeoutMs = TIMEOUT_MS
        return SftpSession(ssh, sftp)
      } catch (e: Exception) {
        runCatching { ssh.disconnect() }
        runCatching { ssh.close() }
        throw if (e is NetFailure) e else classify(e, verifier)
      }
    }

    private inline fun <T> guard(block: () -> T): T = try {
      block()
    } catch (e: NetFailure) {
      throw e
    } catch (e: Exception) {
      throw classify(e, null)
    }

    private fun classify(e: Throwable, verifier: Verifier?): NetFailure {
      when (verifier?.verdict) {
        HostKeys.Verdict.CHANGED -> return NetFailure(
          NetFailure.Kind.HOST_KEY_CHANGED,
          "The server’s host key changed, so Lelap did not connect.",
          e,
        )
        HostKeys.Verdict.NOT_TRUSTED_YET -> return NetFailure(NetFailure.Kind.HOST_KEY_UNKNOWN, "The server’s host key is not trusted yet.", e)
        else -> Unit
      }
      var cause: Throwable? = e
      while (cause != null) {
        when (cause) {
          is UserAuthException -> return NetFailure(NetFailure.Kind.LOGIN, "The server refused the login.", e)
          is SFTPException -> return when (cause.statusCode) {
            Response.StatusCode.NO_SUCH_FILE, Response.StatusCode.NO_SUCH_PATH ->
              NetFailure(NetFailure.Kind.NOT_FOUND, "The folder or file is not on the server.", e)
            Response.StatusCode.PERMISSION_DENIED -> NetFailure(NetFailure.Kind.LOGIN, "The server refused the login.", e)
            else -> NetFailure(NetFailure.Kind.UNREACHABLE, cause.message ?: "The server refused.", e)
          }
          is SocketTimeoutException, is TimeoutException -> return NetFailure(NetFailure.Kind.TIMEOUT, "The server did not answer within 30 s.", e)
          is UnknownHostException, is ConnectException, is NoRouteToHostException ->
            return NetFailure(NetFailure.Kind.UNREACHABLE, "No answer from the server.", e)
        }
        cause = cause.cause
      }
      return NetFailure(NetFailure.Kind.UNREACHABLE, e.message ?: "No answer from the server.", e)
    }
  }
}
