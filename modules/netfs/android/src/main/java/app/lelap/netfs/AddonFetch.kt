package app.lelap.netfs

import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.Proxy
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import okhttp3.Dns
import okhttp3.Headers.Companion.toHeaders
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** A host an add-on declared resolved to an address on the phone's own network. */
class PrivateAddressException(host: String) :
  UnknownHostException("$host points at an address on your own network")

/** What an add-on's fetch got back: the status, the text and the few headers it may see. */
data class AddonAnswer(val status: Int, val url: String, val text: String, val headers: Map<String, String>)

/** An answer larger than the add-on may read. */
class TooLargeException : IOException("The answer was too large.")

/**
 * The fetch behind `lelap.fetch` for add-ons inside the app (M104). Host rules check names, and a
 * name the add-on declared could resolve to the listener's router or NAS. So unless the address is
 * one the listener typed ([localNetwork]), every address the name resolves to must be public, and
 * the check runs in OkHttp's own DNS step, so the name can't change its answer between a check and
 * the connection. No cookies, no redirects followed, a cap on the answer's size.
 */
class AddonFetch(private val system: Dns = Dns.SYSTEM) {
  private val publicOnly = object : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
      val found = system.lookup(hostname)
      if (found.isEmpty() || found.any { !isPublic(it) }) throw PrivateAddressException(hostname)
      return found
    }
  }

  // Two clients sharing one pool: OkHttp keys a pooled connection by its DNS too, so a connection
  // made for a typed address is never reused for a declared one.
  private val base = OkHttpClient.Builder()
    .followRedirects(false)
    .followSslRedirects(false)
    .retryOnConnectionFailure(false)
    .dns(system)
    .build()
  // No proxy for declared hosts: through one, OkHttp resolves only the proxy's name, never theirs.
  private val guarded = base.newBuilder().dns(publicOnly).proxy(Proxy.NO_PROXY).build()

  fun fetch(
    url: String,
    method: String,
    headers: Map<String, String>,
    body: String?,
    timeoutMs: Long,
    maxBytes: Long,
    localNetwork: Boolean,
  ): AddonAnswer {
    val parsed = url.toHttpUrlOrNull() ?: throw IOException("Not an http(s) address")
    // An address written as an IP never reaches the DNS step.
    if (!localNetwork && literal(parsed.host)?.let { isPublic(it) } == false) {
      throw PrivateAddressException(parsed.host)
    }
    // OkHttp unpacks gzip only when it asked for it itself.
    val requestHeaders = headers.filterKeys { !it.equals("Accept-Encoding", ignoreCase = true) }.toHeaders()
    // As `fetch` does for a string body without a type.
    val type = requestHeaders["Content-Type"] ?: "text/plain;charset=UTF-8"
    val requestBody = body?.toRequestBody(type.toMediaTypeOrNull())
      ?: if (method.uppercase() in setOf("POST", "PUT", "PATCH")) ByteArray(0).toRequestBody() else null
    val request = Request.Builder().url(parsed).headers(requestHeaders).method(method.uppercase(), requestBody).build()
    val client = (if (localNetwork) base else guarded).newBuilder()
      .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
      .build()
    client.newCall(request).execute().use { response ->
      val length = response.body?.contentLength() ?: -1L
      if (length > maxBytes) throw TooLargeException()
      val source = response.body?.source()
      val text = if (source == null) {
        ""
      } else {
        // Reads at most one byte past the cap, so a stream without a length can't fill memory.
        if (source.request(maxBytes + 1)) throw TooLargeException()
        val charset = response.body?.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8
        source.buffer.readString(charset)
      }
      val seen = mutableMapOf<String, String>()
      response.header("Content-Type")?.let { seen["content-type"] = it }
      response.headers("Set-Cookie").takeIf { it.isNotEmpty() }?.let { seen["set-cookie"] = it.joinToString(", ") }
      response.header("Date")?.let { seen["date"] = it }
      return AddonAnswer(response.code, response.request.url.toString(), text, seen)
    }
  }

  companion object {
    /** The address when [host] is an IP literal (IPv6 in brackets or not), else null. */
    fun literal(host: String): InetAddress? {
      val bare = host.removePrefix("[").removeSuffix("]")
      val looksLikeIp = bare.contains(':') || bare.matches(Regex("""\d{1,3}(\.\d{1,3}){3}"""))
      return if (looksLikeIp) runCatching { InetAddress.getByName(bare) }.getOrNull() else null
    }

    /**
     * Whether an address is on the internet: not loopback, private, link-local, CGNAT, multicast
     * or reserved. NAT64 and 6to4 addresses are judged by the IPv4 address inside, since an
     * IPv6-only mobile network hands out NAT64 addresses for every public IPv4 server.
     */
    fun isPublic(address: InetAddress): Boolean {
      if (address is Inet4Address) return isPublicV4(address.address)
      if (address !is Inet6Address) return false
      val b = address.address
      val word = { i: Int -> ((b[i].toInt() and 0xff) shl 8) or (b[i + 1].toInt() and 0xff) }
      // 64:ff9b::/96, the well-known NAT64 prefix.
      if (word(0) == 0x64 && word(2) == 0xff9b && (4..11).all { b[it].toInt() == 0 }) {
        return isPublicV4(b.copyOfRange(12, 16))
      }
      // 2002::/16, 6to4.
      if (word(0) == 0x2002) return isPublicV4(b.copyOfRange(2, 6))
      return when {
        // ::/96: unspecified, loopback, IPv4-compatible.
        (0..11).all { b[it].toInt() == 0 } -> false
        // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast.
        (b[0].toInt() and 0xfe) == 0xfc -> false
        (b[0].toInt() and 0xff) == 0xfe && (b[1].toInt() and 0x80) == 0x80 -> false
        (b[0].toInt() and 0xff) == 0xff -> false
        // 64:ff9b:1::/48, local NAT64; 2001:db8::/32, documentation.
        word(0) == 0x64 && word(2) == 0xff9b && word(4) == 1 -> false
        word(0) == 0x2001 && word(2) == 0x0db8 -> false
        else -> true
      }
    }

    private fun isPublicV4(b: ByteArray): Boolean {
      val o = b.map { it.toInt() and 0xff }
      val (a, c) = o[0] to o[1]
      return when {
        a == 0 || a == 10 || a == 127 -> false
        a == 100 && c in 64..127 -> false
        a == 169 && c == 254 -> false
        a == 172 && c in 16..31 -> false
        a == 192 && c == 168 -> false
        a == 192 && c == 0 && o[2] == 0 -> false
        a == 198 && c in 18..19 -> false
        a >= 224 -> false
        else -> true
      }
    }
  }
}
