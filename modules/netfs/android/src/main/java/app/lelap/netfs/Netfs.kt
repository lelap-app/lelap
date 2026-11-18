package app.lelap.netfs

import java.io.Closeable
import java.io.File
import java.io.InputStream

/**
 * What the player, downloads, tags and casting use: a file on an SMB or SFTP server by its
 * address and the login sent with it. Connections are shared through one pool per process.
 */
object Netfs {
  @Volatile private var connector: (NetAddress, NetLogin) -> NetSession = { address, login ->
    if (address.scheme == NetAddress.SMB) SmbSession.connect(address, login) else SftpSession.connect(address, login)
  }

  @Volatile private var pool = SessionPool({ a, l -> connector(a, l) })

  /** Tests swap in a fake server; the old pool's connections are closed. */
  fun useConnector(connect: (NetAddress, NetLogin) -> NetSession, sweepEveryMs: Long? = null) {
    val old = pool
    connector = connect
    pool = SessionPool({ a, l -> connector(a, l) }, sweepEveryMs = sweepEveryMs)
    old.closeAll()
  }

  fun handles(uri: String) = NetAddress.handles(uri)

  private fun target(uri: String, headers: Map<String, String>): Pair<NetAddress, NetLogin> {
    val address = NetAddress.parse(uri) ?: throw NetFailure(NetFailure.Kind.ADDRESS, "Not an SMB or SFTP address.")
    val login = NetLogin.fromHeaders(headers) ?: throw NetFailure(NetFailure.Kind.LOGIN, "No login for this server.")
    return address to login
  }

  /** An open file and the connection it came from; closing it gives the connection back. */
  class Opened internal constructor(val file: NetFile, private val lease: SessionPool.Lease) : Closeable {
    override fun close() {
      runCatching { file.close() }.onFailure { if (breaksConnection(it)) lease.broken() }
      lease.close()
    }

    fun broken() = lease.broken()
  }

  fun open(uri: String, headers: Map<String, String>): Opened {
    val (address, login) = target(uri, headers)
    val lease = pool.lease(address, login)
    try {
      return Opened(lease.session.open(address.path), lease)
    } catch (e: Exception) {
      if (breaksConnection(e)) lease.broken()
      lease.close()
      throw e
    }
  }

  /** Every file below the folder at [uri], bounded by [NetWalk]. */
  fun list(uri: String, headers: Map<String, String>): List<WalkedFile> {
    val (address, login) = target(uri, headers)
    return pool.use(address, login) { NetWalk.list(it, address.path) }
  }

  /** Reads only the folder entered, to check the address and the login before a server is added. */
  fun check(uri: String, headers: Map<String, String>): Pair<Int, Int> {
    val (address, login) = target(uri, headers)
    val entries = pool.use(address, login) { it.list(address.path) }.filter { it.name != "." && it.name != ".." }
    val folders = entries.count { it.folder }
    return folders to entries.size - folders
  }

  fun hostKey(uri: String): SftpSession.HostKey {
    val address = NetAddress.parse(uri)?.takeIf { it.scheme == NetAddress.SFTP }
      ?: throw NetFailure(NetFailure.Kind.ADDRESS, "Not an SFTP address.")
    return SftpSession.hostKey(address)
  }

  /** Copies a whole file, such as a folder's `cover.jpg`, to [target]. */
  fun copyTo(uri: String, headers: Map<String, String>, target: File, maxBytes: Long = 20L shl 20) {
    open(uri, headers).use { opened ->
      if (opened.file.length > maxBytes) throw NetFailure(NetFailure.Kind.NOT_FOUND, "The file is too large.")
      target.outputStream().use { out -> NetInputStream(opened.file, 0).copyTo(out, 64 * 1024) }
    }
  }

  /** For the cast server: the file's length and a stream from an offset, closed with the stream. */
  fun opener(uri: String, headers: Map<String, String>): Pair<Long, (Long) -> InputStream> {
    val length = open(uri, headers).use { it.file.length }
    return length to { offset ->
      val opened = open(uri, headers)
      object : InputStream() {
        private val stream = NetInputStream(opened.file, offset)
        override fun read() = stream.read()
        override fun read(b: ByteArray, off: Int, len: Int) = stream.read(b, off, len)
        override fun skip(n: Long) = stream.skip(n)
        override fun available() = stream.available()
        override fun close() = opened.close()
      }
    }
  }
}
