package app.lelap.netfs

import java.io.Closeable
import java.io.IOException

/** One entry of a folder on the server. [modifiedAt] is in milliseconds since 1970. */
data class NetEntry(
  val name: String,
  val folder: Boolean,
  val size: Long,
  val modifiedAt: Long,
  /** A symbolic link (SFTP): what it points at is looked up with [NetSession.stat]. */
  val link: Boolean = false,
)

/** An open file. [read] fills from [position] and returns -1 at the end, like a stream. */
interface NetFile : Closeable {
  val length: Long
  fun read(position: Long, buffer: ByteArray, offset: Int, length: Int): Int
}

/**
 * A logged-in connection to one server folder tree. Paths are `/`-separated below the share (SMB)
 * or absolute (SFTP), without a trailing slash; the share's root is "".
 */
interface NetSession : Closeable {
  fun list(path: String): List<NetEntry>
  fun stat(path: String): NetEntry
  fun open(path: String): NetFile
  /** False once the connection dropped; the pool then opens a new one. */
  val alive: Boolean
}

/**
 * Why a server could not be used. [Kind.permanent]: trying again will not help (a refused login,
 * a changed host key); the others may pass, such as a server asleep.
 */
class NetFailure(val kind: Kind, message: String, cause: Throwable? = null) : IOException(message, cause) {
  enum class Kind(val code: String, val permanent: Boolean) {
    LOGIN("ERR_NETFS_LOGIN", true),
    HOST_KEY_CHANGED("ERR_NETFS_HOST_KEY_CHANGED", true),
    HOST_KEY_UNKNOWN("ERR_NETFS_HOST_KEY_UNKNOWN", true),
    PRIVATE_KEY("ERR_NETFS_PRIVATE_KEY", true),
    NOT_FOUND("ERR_NETFS_NOT_FOUND", true),
    ADDRESS("ERR_NETFS_ADDRESS", true),
    TIMEOUT("ERR_NETFS_TIMEOUT", false),
    UNREACHABLE("ERR_NETFS_UNREACHABLE", false),
  }
}
