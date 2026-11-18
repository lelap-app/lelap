package app.lelap.netfs

import com.hierynomus.msdtyp.AccessMask
import com.hierynomus.msfscc.FileAttributes
import com.hierynomus.mserref.NtStatus
import com.hierynomus.mssmb2.SMB2CreateDisposition
import com.hierynomus.mssmb2.SMB2ShareAccess
import com.hierynomus.mssmb2.SMBApiException
import com.hierynomus.security.bc.BCSecurityProvider
import com.hierynomus.smbj.SMBClient
import com.hierynomus.smbj.SmbConfig
import com.hierynomus.smbj.auth.AuthenticationContext
import com.hierynomus.smbj.connection.Connection
import com.hierynomus.smbj.session.Session
import com.hierynomus.smbj.share.DiskShare
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.EnumSet
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** A share on a Windows PC, NAS or Samba server, over SMB 2 or 3 with smbj. */
class SmbSession private constructor(
  private val client: SMBClient,
  private val connection: Connection,
  private val session: Session,
  private val share: DiskShare,
) : NetSession {
  override val alive: Boolean
    get() = connection.isConnected && share.isConnected

  // smbj names paths with backslashes below the share.
  private fun smbPath(path: String) = path.trim('/').replace('/', '\\')

  override fun list(path: String): List<NetEntry> = guard {
    share.list(smbPath(path)).map { info ->
      NetEntry(
        name = info.fileName,
        folder = info.fileAttributes and FileAttributes.FILE_ATTRIBUTE_DIRECTORY.value != 0L,
        size = info.endOfFile,
        modifiedAt = info.lastWriteTime.toEpochMillis(),
      )
    }
  }

  override fun stat(path: String): NetEntry = guard {
    val info = share.getFileInformation(smbPath(path))
    NetEntry(
      name = path.substringAfterLast('/'),
      folder = info.standardInformation.isDirectory,
      size = info.standardInformation.endOfFile,
      modifiedAt = info.basicInformation.lastWriteTime.toEpochMillis(),
    )
  }

  override fun open(path: String): NetFile = guard {
    val file = share.openFile(
      smbPath(path),
      EnumSet.of(AccessMask.GENERIC_READ),
      null,
      // Others may keep reading and writing it: a NAS indexer, another player.
      SMB2ShareAccess.ALL,
      SMB2CreateDisposition.FILE_OPEN,
      null,
    )
    try {
      val length = file.fileInformation.standardInformation.endOfFile
      object : NetFile {
        override val length = length
        override fun read(position: Long, buffer: ByteArray, offset: Int, length: Int): Int = guard {
          if (position >= this.length) -1 else file.read(buffer, position, offset, length)
        }
        override fun close() = file.close()
      }
    } catch (e: Exception) {
      runCatching { file.close() }
      throw e
    }
  }

  override fun close() {
    runCatching { share.close() }
    runCatching { session.close() }
    runCatching { connection.close() }
    runCatching { client.close() }
  }

  companion object {
    private const val TIMEOUT_S = 30L

    fun connect(address: NetAddress, login: NetLogin): SmbSession {
      val config = SmbConfig.builder()
        // Each request, not a whole listing, has this long; like WebDAV's 30 s.
        .withTimeout(TIMEOUT_S, TimeUnit.SECONDS)
        .withSoTimeout(TIMEOUT_S, TimeUnit.SECONDS)
        // Android's crypto has no MD4, which NTLM needs; Bouncy Castle's light API does.
        .withSecurityProvider(BCSecurityProvider())
        .build()
      val client = SMBClient(config)
      var connection: Connection? = null
      var session: Session? = null
      try {
        connection = guard { client.connect(address.host, address.port) }
        val auth = when {
          login.user.isEmpty() -> AuthenticationContext.anonymous()
          login.user.equals("guest", ignoreCase = true) && login.password.isNullOrEmpty() -> AuthenticationContext.guest()
          else -> AuthenticationContext(login.user, login.password.orEmpty().toCharArray(), login.domain)
        }
        session = guard { connection.authenticate(auth) }
        val share = guard { session.connectShare(address.share) } as? DiskShare
          ?: throw NetFailure(NetFailure.Kind.NOT_FOUND, "${address.share} is not a folder share.")
        return SmbSession(client, connection, session, share)
      } catch (e: Exception) {
        runCatching { session?.close() }
        runCatching { connection?.close() }
        runCatching { client.close() }
        throw e
      }
    }

    /** smbj's errors as [NetFailure], so callers tell a refused login from a server asleep. */
    private inline fun <T> guard(block: () -> T): T = try {
      block()
    } catch (e: NetFailure) {
      throw e
    } catch (e: SMBApiException) {
      throw when (e.status) {
        NtStatus.STATUS_LOGON_FAILURE, NtStatus.STATUS_ACCOUNT_DISABLED, NtStatus.STATUS_PASSWORD_EXPIRED,
        -> NetFailure(NetFailure.Kind.LOGIN, "The server refused the login.", e)
        NtStatus.STATUS_ACCESS_DENIED -> NetFailure(NetFailure.Kind.DENIED, "This login may not read it.", e)
        NtStatus.STATUS_OBJECT_NAME_NOT_FOUND, NtStatus.STATUS_OBJECT_PATH_NOT_FOUND, NtStatus.STATUS_BAD_NETWORK_NAME,
        NtStatus.STATUS_NOT_FOUND, NtStatus.STATUS_NO_SUCH_FILE,
        -> NetFailure(NetFailure.Kind.NOT_FOUND, "The share or folder is not on the server.", e)
        else -> NetFailure(NetFailure.Kind.UNREACHABLE, "The server answered ${e.status}.", e)
      }
    } catch (e: Exception) {
      // A seek stopped this read; the connection is fine.
      if (interrupted(e)) throw InterruptedIOException().apply { initCause(e) }
      throw classify(e)
    }

    private fun classify(e: Throwable): NetFailure {
      var cause: Throwable? = e
      while (cause != null) {
        when (cause) {
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
