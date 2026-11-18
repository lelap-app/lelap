package app.lelap.netfs

import java.security.MessageDigest
import org.json.JSONException
import org.json.JSONObject

/**
 * The login JavaScript sends with a file's address, in the `X-Lelap-Netfs` header
 * (`netfsHeaders` in `@lelap/core`). It never goes out over HTTP: these addresses are not web ones.
 */
data class NetLogin(
  val username: String,
  val password: String? = null,
  val privateKey: String? = null,
  val passphrase: String? = null,
  /** SFTP: the key trusted when the server was added, as `SHA256:…`. */
  val hostKey: String? = null,
) {
  /** `DOMAIN\user` names a Windows domain for SMB. */
  val domain: String?
    get() = username.substringBefore('\\', "").ifEmpty { null }

  val user: String
    get() = username.substringAfter('\\')

  /** Tells logins apart for the connection pool without keeping a second copy of the secret. */
  val fingerprint: String by lazy {
    val text = listOf(username, password, privateKey, passphrase, hostKey).joinToString("\u0000") { it.orEmpty() }
    MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
  }

  // Never print the secrets, even in a crash report.
  override fun toString() = "NetLogin(username=$username)"

  companion object {
    const val HEADER = "X-Lelap-Netfs"

    fun fromHeaders(headers: Map<String, String>): NetLogin? {
      val json = headers.entries.firstOrNull { it.key.equals(HEADER, ignoreCase = true) }?.value ?: return null
      return decode(json)
    }

    fun decode(json: String): NetLogin? = try {
      val o = JSONObject(json)
      fun opt(key: String) = if (o.isNull(key)) null else o.optString(key).ifEmpty { null }
      NetLogin(
        username = o.optString("username"),
        password = opt("password"),
        privateKey = opt("privateKey"),
        passphrase = opt("passphrase"),
        hostKey = opt("hostKey"),
      )
    } catch (e: JSONException) {
      null
    }
  }
}
