package app.lelap.library

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * A login (WebDAV's, or the headers an add-on inside the app asked for) belongs to the server it
 * was given for. HttpURLConnection and Media3 send the same headers after a redirect, to any host,
 * so redirects are followed here by hand and the headers go only to the first server. The same
 * file is in modules/audio, modules/cast and modules/library; each module builds on its own.
 */
object LoginRedirects {
  private const val MAX_REDIRECTS = 10

  private fun URL.portOrDefault() = if (port >= 0) port else defaultPort

  /** Same scheme, host and port: the server a login was given for. */
  fun sameServer(origin: URL, target: URL): Boolean =
    origin.protocol.equals(target.protocol, ignoreCase = true) &&
      origin.host.equals(target.host, ignoreCase = true) &&
      origin.portOrDefault() == target.portOrDefault()

  /**
   * Opens [url], following redirects by hand: [headers] are sent while the address stays on the
   * first server and dropped once a redirect leaves it. A Digest login among them
   * ([HttpDigest.LOGIN_HEADER], M135) is answered there instead of sent. [configure] sets the rest
   * of each request.
   */
  fun open(url: String, headers: Map<String, String>, configure: (HttpURLConnection) -> Unit): HttpURLConnection {
    val (plain, digest) = HttpDigest.split(headers)
    val origin = URL(url)
    var current = origin
    var redirects = 0
    var answered = false
    while (true) {
      if (current.protocol != "http" && current.protocol != "https") throw IOException("Not a web address.")
      val c = current.openConnection() as HttpURLConnection
      c.instanceFollowRedirects = false
      configure(c)
      val own = sameServer(origin, current)
      if (own) {
        plain.forEach { (name, value) -> c.setRequestProperty(name, value) }
        if (digest != null) HttpDigest.answer(current, digest, c.requestMethod)?.let { c.setRequestProperty("Authorization", it) }
      }
      val code = c.responseCode
      // Refused: once more with the server's new challenge, such as for a nonce gone stale.
      if (code == 401 && own && digest != null && !answered) {
        val challenge = HttpDigest.challenge(HttpDigest.challenges(c))
        if (challenge != null) {
          c.disconnect()
          HttpDigest.remember(current, digest, challenge)
          answered = true
          continue
        }
      }
      val location = c.getHeaderField("Location")
      if (code in 300..399 && code != 304 && location != null) {
        c.disconnect()
        if (++redirects >= MAX_REDIRECTS) throw IOException("Too many redirects.")
        current = URL(current, location)
      } else {
        return c
      }
    }
  }

  /** Where [url] ends up after its redirects, and whether that is still the first server. */
  fun resolve(url: String, headers: Map<String, String>): Pair<String, Boolean> {
    val c = open(url, headers) {
      it.connectTimeout = 15_000
      it.readTimeout = 15_000
      it.setRequestProperty("User-Agent", "Lelap")
      it.setRequestProperty("Range", "bytes=0-0")
    }
    try {
      return c.url.toString() to sameServer(URL(url), c.url)
    } finally {
      c.disconnect()
    }
  }
}
