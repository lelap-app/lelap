package app.lelap.netfs

import java.net.URLDecoder

/**
 * A file or folder address the app built with `netRootUri` in `@lelap/core`:
 * `smb://host[:port]/share/path` or `sftp://host[:port]/path`, each segment percent-encoded.
 */
data class NetAddress(
  val scheme: String,
  val host: String,
  val port: Int,
  /** SMB only. */
  val share: String?,
  /** Decoded; below the share for SMB, absolute for SFTP (`/home/me/Books`, or `/`). */
  val path: String,
) {
  /** The same server and login place: a pooled connection fits. */
  val server: String
    get() = "$scheme://$host:$port/${share.orEmpty()}"

  companion object {
    const val SMB = "smb"
    const val SFTP = "sftp"
    private val PATTERN = Regex("""^(smb|sftp)://(\[[0-9A-Fa-f:.]+]|[^/:?#\[\]@]+)(?::(\d{1,5}))?(/[^?#]*)?$""", RegexOption.IGNORE_CASE)

    fun handles(uri: String): Boolean {
      val lower = uri.lowercase()
      return lower.startsWith("smb://") || lower.startsWith("sftp://")
    }

    /** Null for anything else, or a path that climbs out with `..`. */
    fun parse(uri: String): NetAddress? {
      val match = PATTERN.matchEntire(uri.trim()) ?: return null
      val scheme = match.groupValues[1].lowercase()
      val host = match.groupValues[2].lowercase().removePrefix("[").removeSuffix("]")
      val port = match.groupValues[3].takeIf { it.isNotEmpty() }?.toIntOrNull()
        ?: if (scheme == SMB) 445 else 22
      if (port !in 1..65_535) return null
      val segments = match.groupValues[4].split('/').filter { it.isNotEmpty() && it != "." }.map {
        // `+` is a plus here: encodeURIComponent writes a space as %20.
        URLDecoder.decode(it.replace("+", "%2B"), "UTF-8")
      }
      if (segments.any { it == ".." || it.contains('/') || it.contains('\\') || it.contains('\u0000') }) return null
      return if (scheme == SMB) {
        val share = segments.firstOrNull() ?: return null
        NetAddress(scheme, host, port, share, segments.drop(1).joinToString("/"))
      } else {
        NetAddress(scheme, host, port, null, "/" + segments.joinToString("/"))
      }
    }

    /** [path] and [name] joined the way the session expects. */
    fun child(path: String, name: String): String = when {
      path.isEmpty() -> name
      path.endsWith("/") -> path + name
      else -> "$path/$name"
    }
  }
}
