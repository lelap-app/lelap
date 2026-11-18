package app.lelap.cast

import java.io.ByteArrayInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

/** SSDP search for UPnP media renderers: Sonos, DLNA speakers and TVs. */
object Ssdp {
  const val ADDRESS = "239.255.255.250"
  const val PORT = 1900
  const val MEDIA_RENDERER = "urn:schemas-upnp-org:device:MediaRenderer:1"

  data class Response(val location: String, val usn: String?, val st: String?, val server: String?)

  fun searchMessage(st: String = MEDIA_RENDERER, mx: Int = 2): String =
    "M-SEARCH * HTTP/1.1\r\n" +
      "HOST: $ADDRESS:$PORT\r\n" +
      "MAN: \"ssdp:discover\"\r\n" +
      "MX: $mx\r\n" +
      "ST: $st\r\n" +
      "USER-AGENT: Android UPnP/1.1 Lelap/1.0\r\n" +
      "\r\n"

  /** A search answer or an alive notice that carries a LOCATION; null for anything else. */
  fun parseResponse(text: String): Response? {
    val input = ByteArrayInputStream(text.toByteArray(Charsets.UTF_8))
    val first = MiniHttp.readLine(input) ?: return null
    val isAnswer = first.startsWith("HTTP/1.1 200") || first.startsWith("HTTP/1.0 200")
    val isNotify = first.startsWith("NOTIFY ")
    if (!isAnswer && !isNotify) return null
    // Any device can send this: too many headers is an answer to skip, not the end of the search.
    val headers = try {
      MiniHttp.readHeaders(input)
    } catch (e: java.io.IOException) {
      return null
    }
    if (isNotify && headers["nts"] != "ssdp:alive") return null
    val location = headers["location"]?.takeIf { it.startsWith("http://") } ?: return null
    return Response(location, headers["usn"], headers["st"] ?: headers["nt"], headers["server"])
  }

  /**
   * Whether an answer's LOCATION names the device that sent it, by address. Anyone on the network
   * can answer a search; without this the phone would fetch whatever host an answer names,
   * `127.0.0.1` or a router's admin page included. Renderers give their own IP address here.
   */
  fun fromSender(location: String, sender: InetAddress): Boolean {
    val host = runCatching { java.net.URI(location).host }.getOrNull()?.removeSurrounding("[", "]") ?: return false
    val literal = host.contains(':') || host.matches(Regex("\\d{1,3}(\\.\\d{1,3}){3}"))
    // A name would need a DNS lookup, which could answer with any address.
    if (!literal) return false
    return runCatching { InetAddress.getByName(host) }.getOrNull() == sender
  }

  /** Whether every address a description gives is on the host its LOCATION named. */
  fun sameHost(location: String, urls: List<String?>): Boolean {
    val host = runCatching { java.net.URI(location).host }.getOrNull() ?: return false
    return urls.filterNotNull().all { url ->
      runCatching { java.net.URI(url).host }.getOrNull().equals(host, ignoreCase = true)
    }
  }

  /** `uuid:abc::urn:...` to `uuid:abc`, the device's own identity. */
  fun uuidOf(usn: String?): String? = usn?.substringBefore("::")?.takeIf { it.startsWith("uuid:") }

  /** Sends the search twice (UDP gets lost) and reports answers until [timeoutMs] runs out. */
  fun search(timeoutMs: Int, onAnswer: (Response) -> Unit) {
    DatagramSocket().use { socket ->
      val bytes = searchMessage().toByteArray(Charsets.UTF_8)
      val group = InetAddress.getByName(ADDRESS)
      repeat(2) { socket.send(DatagramPacket(bytes, bytes.size, group, PORT)) }
      val deadline = System.currentTimeMillis() + timeoutMs
      val buffer = ByteArray(4_096)
      while (true) {
        val left = deadline - System.currentTimeMillis()
        if (left <= 0) break
        socket.soTimeout = left.toInt()
        val packet = DatagramPacket(buffer, buffer.size)
        try {
          socket.receive(packet)
        } catch (e: SocketTimeoutException) {
          break
        }
        parseResponse(String(packet.data, 0, packet.length, Charsets.UTF_8))
          ?.takeIf { fromSender(it.location, packet.address) }
          ?.let(onAnswer)
      }
    }
  }
}
