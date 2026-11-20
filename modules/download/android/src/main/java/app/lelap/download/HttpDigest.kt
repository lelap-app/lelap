package app.lelap.download

import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * HTTP Digest (RFC 7616) for a library's login (M135), such as a Calibre content server's default
 * without https. The app hands the login over as the [LOGIN_HEADER] header, which never goes on
 * the wire: each request is answered on its own, since Calibre checks every request's `uri`. A
 * server's last challenge is kept, so only its first request, or one after the nonce went stale,
 * costs a refusal. The same file is in modules/audio, modules/cast, modules/download and
 * modules/library; each module builds on its own.
 */
object HttpDigest {
  const val LOGIN_HEADER = "X-Lelap-Digest"

  class Login(val username: String, val password: String)

  class Challenge(
    val realm: String,
    val nonce: String,
    /** `auth` or `auth-int`; null for a server from before RFC 2617's qop. */
    val qop: String?,
    val opaque: String?,
    /** `MD5`, `MD5-sess`, `SHA-256` or `SHA-256-sess`. */
    val algorithm: String,
  )

  private class Known(val challenge: Challenge, var count: Int)

  private val known = ConcurrentHashMap<String, Known>()
  private val random = SecureRandom()

  /** [headers] without a Digest login, and the login when they carry one. */
  fun split(headers: Map<String, String>): Pair<Map<String, String>, Login?> {
    val entry = headers.entries.firstOrNull { it.key.equals(LOGIN_HEADER, ignoreCase = true) }
      ?: return headers to null
    return headers.filterKeys { !it.equals(LOGIN_HEADER, ignoreCase = true) } to parseLogin(entry.value)
  }

  /** `base64(user):base64(password)`, as the app writes it. */
  @OptIn(ExperimentalEncodingApi::class)
  fun parseLogin(value: String): Login? {
    val colon = value.indexOf(':')
    if (colon <= 0) return null
    return runCatching {
      Login(
        Base64.Default.decode(value.substring(0, colon)).toString(Charsets.UTF_8),
        Base64.Default.decode(value.substring(colon + 1)).toString(Charsets.UTF_8),
      )
    }.getOrNull()
  }

  /** The strongest Digest challenge among a refusal's `WWW-Authenticate` values; null for none. */
  fun challenge(values: List<String>): Challenge? =
    values.flatMap(::parseChallenges)
      .sortedBy { if (it.algorithm.startsWith("SHA-256")) 0 else 1 }
      .firstOrNull()

  /** The `WWW-Authenticate` values of an answer. */
  fun challenges(connection: HttpURLConnection): List<String> =
    connection.headerFields.entries
      .filter { it.key?.equals("WWW-Authenticate", ignoreCase = true) == true }
      .flatMap { it.value }

  private val TOKEN = Regex("""[!#$%&'*+.^_`|~0-9A-Za-z-]+""")

  /** Every Digest challenge in one header value, which may hold several schemes. */
  fun parseChallenges(header: String): List<Challenge> {
    val out = mutableListOf<Challenge>()
    var i = 0
    var scheme: String? = null
    var params = mutableMapOf<String, String>()
    fun finish() {
      if (scheme.equals("Digest", ignoreCase = true)) toChallenge(params)?.let(out::add)
    }
    while (i < header.length) {
      while (i < header.length && (header[i] == ' ' || header[i] == ',' || header[i] == '\t')) i++
      val token = TOKEN.matchAt(header, i) ?: break
      var j = token.range.last + 1
      while (j < header.length && header[j] == ' ') j++
      if (j < header.length && header[j] == '=') {
        // A parameter of the current scheme.
        j++
        while (j < header.length && header[j] == ' ') j++
        val value = StringBuilder()
        if (j < header.length && header[j] == '"') {
          j++
          while (j < header.length && header[j] != '"') {
            if (header[j] == '\\' && j + 1 < header.length) j++
            value.append(header[j])
            j++
          }
          j++
        } else {
          while (j < header.length && header[j] != ',' && header[j] != ' ') value.append(header[j++])
        }
        params[token.value.lowercase()] = value.toString()
        i = j
      } else {
        // A new scheme starts.
        finish()
        scheme = token.value
        params = mutableMapOf()
        i = j
      }
    }
    finish()
    return out
  }

  private fun toChallenge(params: Map<String, String>): Challenge? {
    val nonce = params["nonce"] ?: return null
    val algorithm = when (params["algorithm"]?.uppercase()) {
      null, "MD5" -> "MD5"
      "MD5-SESS" -> "MD5-sess"
      "SHA-256" -> "SHA-256"
      "SHA-256-SESS" -> "SHA-256-sess"
      else -> return null
    }
    val offered = params["qop"]?.split(',')?.map { it.trim().lowercase() }
    val qop = when {
      offered == null -> null
      "auth" in offered -> "auth"
      "auth-int" in offered -> "auth-int"
      else -> return null
    }
    return Challenge(params["realm"] ?: "", nonce, qop, params["opaque"], algorithm)
  }

  private fun hash(algorithm: String, text: String): String {
    val name = if (algorithm.startsWith("SHA-256")) "SHA-256" else "MD5"
    return MessageDigest.getInstance(name).digest(text.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
  }

  private fun percent(text: String): String =
    text.toByteArray(Charsets.UTF_8).joinToString("") { byte ->
      val c = byte.toInt() and 0xff
      if (c.toChar().isLetterOrDigit() && c < 0x80 || c.toChar() in "-._~") c.toChar().toString() else "%%%02X".format(c)
    }

  private fun quoted(text: String) = "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

  /** The `Authorization` value for one request; [nc] counts the requests made with this nonce. */
  fun authorization(c: Challenge, login: Login, method: String, uri: String, nc: Int, cnonce: String): String {
    val h = { text: String -> hash(c.algorithm, text) }
    var ha1 = h("${login.username}:${c.realm}:${login.password}")
    if (c.algorithm.endsWith("-sess")) ha1 = h("$ha1:${c.nonce}:$cnonce")
    // Requests here have no body, so auth-int hashes an empty one.
    val ha2 = if (c.qop == "auth-int") h("$method:$uri:${h("")}") else h("$method:$uri")
    val count = "%08x".format(nc)
    val response = if (c.qop == null) h("$ha1:${c.nonce}:$ha2") else h("$ha1:${c.nonce}:$count:$cnonce:${c.qop}:$ha2")
    // A name beyond ASCII goes in RFC 7616's extended form: headers carry ASCII only.
    val ascii = login.username.all { it.code in 0x20..0x7e }
    val parts = mutableListOf(
      if (ascii) "username=${quoted(login.username)}" else "username*=UTF-8''${percent(login.username)}",
      "realm=${quoted(c.realm)}",
      "nonce=${quoted(c.nonce)}",
      "uri=${quoted(uri)}",
      "algorithm=${c.algorithm}",
      "response=\"$response\"",
    )
    if (c.qop != null) parts += listOf("qop=${c.qop}", "nc=$count", "cnonce=\"$cnonce\"")
    c.opaque?.let { parts += "opaque=${quoted(it)}" }
    return "Digest " + parts.joinToString(", ")
  }

  /** The part of [url] a Digest `uri` names: its path and query. */
  fun requestUri(url: URL): String = url.file.ifEmpty { "/" }

  private fun key(url: URL, login: Login): String {
    val port = if (url.port >= 0) url.port else url.defaultPort
    return "${url.protocol.lowercase()}://${url.host.lowercase()}:$port\n${login.username}"
  }

  /** Remembers [challenge] as [url]'s server's latest, so its next requests answer it at once. */
  fun remember(url: URL, login: Login, challenge: Challenge) {
    known[key(url, login)] = Known(challenge, 0)
  }

  /** The `Authorization` for a request to [url] from its server's latest challenge; null before one. */
  fun answer(url: URL, login: Login, method: String): String? {
    val entry = known[key(url, login)] ?: return null
    val nc = synchronized(entry) { ++entry.count }
    val cnonce = ByteArray(8).also(random::nextBytes).joinToString("") { "%02x".format(it) }
    return authorization(entry.challenge, login, method, requestUri(url), nc, cnonce)
  }
}
