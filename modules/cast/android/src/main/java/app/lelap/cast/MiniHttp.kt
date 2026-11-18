package app.lelap.cast

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI

class HttpResponse(val status: Int, val headers: Map<String, String>, val body: ByteArray) {
  fun text(): String = String(body, Charsets.UTF_8)
}

/**
 * Plain HTTP/1.1 over a socket, for UPnP descriptions and SOAP calls on the LAN. Android's
 * cleartext policy would block HttpURLConnection to these addresses, and they are never https.
 */
object MiniHttp {
  private const val MAX_BODY = 1 shl 20
  const val MAX_HEADERS = 100
  const val MAX_HEADER_BYTES = 32 * 1024

  fun request(
    method: String,
    url: String,
    headers: Map<String, String> = emptyMap(),
    body: ByteArray? = null,
    timeoutMs: Int = 5_000,
  ): HttpResponse {
    val uri = URI(url)
    if (uri.scheme != "http") throw IOException("Only http on the local network: $url")
    val port = if (uri.port > 0) uri.port else 80
    val path = (uri.rawPath?.ifEmpty { "/" } ?: "/") + (uri.rawQuery?.let { "?$it" } ?: "")
    Socket().use { socket ->
      socket.connect(InetSocketAddress(uri.host, port), timeoutMs)
      socket.soTimeout = timeoutMs
      val head = StringBuilder()
        .append("$method $path HTTP/1.1\r\n")
        .append("Host: ${uri.host}:$port\r\n")
        .append("Connection: close\r\n")
        .append("User-Agent: Lelap UPnP/1.0\r\n")
      headers.forEach { (k, v) -> head.append("$k: $v\r\n") }
      if (body != null) head.append("Content-Length: ${body.size}\r\n")
      head.append("\r\n")
      val out = socket.getOutputStream()
      out.write(head.toString().toByteArray(Charsets.UTF_8))
      if (body != null) out.write(body)
      out.flush()
      return read(socket.getInputStream())
    }
  }

  /** Reads one response; the connection is closed after it. */
  fun read(input: InputStream): HttpResponse {
    val statusLine = readLine(input) ?: throw IOException("Empty response")
    val status = statusLine.split(' ').getOrNull(1)?.toIntOrNull() ?: throw IOException("Bad status: $statusLine")
    val headers = readHeaders(input)
    val body = when {
      headers["transfer-encoding"]?.contains("chunked", ignoreCase = true) == true -> readChunked(input)
      headers["content-length"] != null -> readExactly(input, headers.getValue("content-length").trim().toInt())
      else -> readAll(input)
    }
    return HttpResponse(status, headers, body)
  }

  /**
   * Header names in lower case; the last of repeated headers wins. At most [MAX_HEADERS] lines
   * and [MAX_HEADER_BYTES] in all, and nothing past [deadline] (`System.nanoTime()`): anyone on
   * the network can talk to the media server or answer discovery.
   */
  fun readHeaders(input: InputStream, deadline: Long = Long.MAX_VALUE): Map<String, String> {
    val headers = linkedMapOf<String, String>()
    var lines = 0
    var bytes = 0
    while (true) {
      val line = readLine(input, deadline) ?: break
      if (line.isEmpty()) break
      bytes += line.length
      if (++lines > MAX_HEADERS || bytes > MAX_HEADER_BYTES) throw IOException("Too many headers")
      val colon = line.indexOf(':')
      if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
    }
    return headers
  }

  /** One CRLF- or LF-terminated line, or null at the end of the stream. */
  fun readLine(input: InputStream, deadline: Long = Long.MAX_VALUE): String? {
    val buffer = ByteArrayOutputStream()
    while (true) {
      val b = input.read()
      if (System.nanoTime() > deadline) throw IOException("Too slow")
      if (b < 0) return if (buffer.size() == 0) null else buffer.toString(Charsets.UTF_8.name())
      if (b == '\n'.code) break
      if (buffer.size() > 16_384) throw IOException("Header line too long")
      buffer.write(b)
    }
    return buffer.toString(Charsets.UTF_8.name()).trimEnd('\r')
  }

  private fun readExactly(input: InputStream, length: Int): ByteArray {
    if (length > MAX_BODY) throw IOException("Response too large")
    val bytes = ByteArray(length)
    var read = 0
    while (read < length) {
      val n = input.read(bytes, read, length - read)
      if (n < 0) throw IOException("Response ended early")
      read += n
    }
    return bytes
  }

  private fun readChunked(input: InputStream): ByteArray {
    val out = ByteArrayOutputStream()
    while (true) {
      val size = readLine(input)?.substringBefore(';')?.trim()?.toInt(16) ?: throw IOException("Bad chunk")
      if (size == 0) break
      if (out.size() + size > MAX_BODY) throw IOException("Response too large")
      out.write(readExactly(input, size))
      readLine(input)
    }
    return out.toByteArray()
  }

  private fun readAll(input: InputStream): ByteArray {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(8_192)
    while (true) {
      val n = input.read(buffer)
      if (n < 0) break
      out.write(buffer, 0, n)
      if (out.size() > MAX_BODY) throw IOException("Response too large")
    }
    return out.toByteArray()
  }
}
