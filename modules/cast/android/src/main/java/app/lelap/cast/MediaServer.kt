package app.lelap.cast

import android.content.Context
import android.net.ConnectivityManager
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Byte ranges as receivers ask for them. */
object Ranges {
  sealed class Result {
    object Full : Result()
    data class Partial(val start: Long, val end: Long) : Result()
    object Unsatisfiable : Result()
  }

  /** `bytes=a-b`, `bytes=a-` and `bytes=-n`; anything else (or several ranges) means the whole. */
  fun parse(header: String?, length: Long): Result {
    val spec = header?.trim()?.removePrefix("bytes=")?.takeIf { header.trim().startsWith("bytes=") } ?: return Result.Full
    if (spec.contains(',')) return Result.Full
    val dash = spec.indexOf('-')
    if (dash < 0) return Result.Full
    val first = spec.substring(0, dash).trim()
    val last = spec.substring(dash + 1).trim()
    if (first.isEmpty()) {
      val suffix = last.toLongOrNull() ?: return Result.Full
      if (suffix <= 0) return Result.Unsatisfiable
      return Result.Partial((length - suffix).coerceAtLeast(0L), length - 1)
    }
    val start = first.toLongOrNull() ?: return Result.Full
    if (start >= length) return Result.Unsatisfiable
    val end = if (last.isEmpty()) length - 1 else (last.toLongOrNull() ?: return Result.Full).coerceAtMost(length - 1)
    if (end < start) return Result.Unsatisfiable
    return Result.Partial(start, end)
  }
}

/**
 * A tiny HTTP server on the Wi-Fi address, so receivers can fetch files that live on the phone.
 * Each file is reachable only under a random token, and only while casting. Streams that need a
 * login (WebDAV) are passed through from their own host, since receivers cannot send headers.
 * Audio still never touches Lelap's servers.
 */
class MediaServer(private val context: Context) {
  sealed class Source {
    data class Local(val uri: String) : Source()
    data class Remote(val url: String, val headers: Map<String, String>) : Source()
  }

  private class Entry(val source: Source, val mimeType: String)

  private val entries = ConcurrentHashMap<String, Entry>()
  private val random = SecureRandom()
  private val pool = Executors.newFixedThreadPool(6) { Thread(it, "lelap-cast-server").apply { isDaemon = true } }
  private var server: ServerSocket? = null
  private var base: String? = null

  /** Starts on the phone's Wi-Fi address; returns the base URL. */
  @Synchronized
  fun start(): String {
    base?.let { return it }
    val address = lanAddress() ?: throw CastException("Connect the phone to the same Wi-Fi as the speaker")
    val socket = ServerSocket(0, 16, address)
    server = socket
    Thread({ accept(socket) }, "lelap-cast-accept").apply { isDaemon = true }.start()
    return "http://${address.hostAddress}:${socket.localPort}".also { base = it }
  }

  @Synchronized
  fun stop() {
    entries.clear()
    runCatching { server?.close() }
    server = null
    base = null
  }

  /** A URL a receiver can fetch [source] from. [name] gives the extension receivers look at. */
  fun publish(source: Source, mimeType: String, name: String): String {
    val root = start()
    val bytes = ByteArray(16).also(random::nextBytes)
    val token = bytes.joinToString("") { "%02x".format(it) }
    entries[token] = Entry(source, mimeType)
    val ext = Mime.extension(name).ifEmpty { "bin" }
    return "$root/$token/media.$ext"
  }

  /** The file name of a local URI, for its type. */
  fun displayName(uri: String): String {
    if (uri.startsWith("file://")) return Uri.parse(uri).lastPathSegment ?: uri
    if (uri.startsWith("content://")) {
      runCatching {
        context.contentResolver.query(Uri.parse(uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
          if (c.moveToFirst()) return c.getString(0)
        }
      }
    }
    return uri
  }

  private fun lanAddress(): InetAddress? {
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    val network = connectivity.activeNetwork ?: return null
    return connectivity.getLinkProperties(network)?.linkAddresses
      ?.map { it.address }
      ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
  }

  private fun accept(socket: ServerSocket) {
    while (!socket.isClosed) {
      val client = try {
        socket.accept()
      } catch (e: IOException) {
        return
      }
      pool.execute { client.use { runCatching { serve(it) } } }
    }
  }

  private fun serve(client: Socket) {
    client.soTimeout = 30_000
    val input = client.getInputStream()
    val request = MiniHttp.readLine(input) ?: return
    val headers = MiniHttp.readHeaders(input)
    val parts = request.split(' ')
    val method = parts.getOrNull(0) ?: return
    val token = parts.getOrNull(1)?.trimStart('/')?.substringBefore('/') ?: return
    val out = client.getOutputStream()
    if (method != "GET" && method != "HEAD") return status(out, 405, "Method Not Allowed")
    val entry = entries[token] ?: return status(out, 404, "Not Found")
    when (val source = entry.source) {
      is Source.Local -> serveLocal(out, source.uri, entry.mimeType, headers["range"], method == "HEAD")
      is Source.Remote -> serveRemote(out, source, entry.mimeType, headers["range"], method == "HEAD")
    }
  }

  private fun serveLocal(out: OutputStream, uri: String, mimeType: String, range: String?, head: Boolean) {
    val (length, open) = openLocal(uri) ?: return status(out, 404, "Not Found")
    when (val r = Ranges.parse(range, length)) {
      Ranges.Result.Unsatisfiable -> {
        writeHead(out, 416, "Range Not Satisfiable", mapOf("Content-Range" to "bytes */$length", "Content-Length" to "0"))
      }
      Ranges.Result.Full -> {
        writeHead(out, 200, "OK", mediaHeaders(mimeType) + ("Content-Length" to "$length"))
        if (!head) open(0).use { copy(it, out, length) }
      }
      is Ranges.Result.Partial -> {
        val size = r.end - r.start + 1
        writeHead(
          out,
          206,
          "Partial Content",
          mediaHeaders(mimeType) + mapOf("Content-Length" to "$size", "Content-Range" to "bytes ${r.start}-${r.end}/$length"),
        )
        if (!head) open(r.start).use { copy(it, out, size) }
      }
    }
  }

  /** The length and an opener at an offset, for a `file://` or `content://` URI. */
  private fun openLocal(uri: String): Pair<Long, (Long) -> InputStream>? = when {
    uri.startsWith("file://") -> {
      val file = File(Uri.parse(uri).path ?: return null)
      if (!file.isFile) null else file.length() to { offset -> FileInputStream(file).also { it.channel.position(offset) } }
    }
    uri.startsWith("content://") -> {
      val parsed = Uri.parse(uri)
      val length = context.contentResolver.openAssetFileDescriptor(parsed, "r")?.use { it.length }
      if (length == null || length < 0) {
        null
      } else {
        length to { offset ->
          val fd = context.contentResolver.openAssetFileDescriptor(parsed, "r") ?: throw IOException("Gone: $uri")
          // skip(), not the channel: the stream keeps its own offset inside the asset.
          fd.createInputStream().also { stream ->
            var left = offset
            while (left > 0) {
              val skipped = stream.skip(left)
              if (skipped <= 0) throw IOException("Could not skip in $uri")
              left -= skipped
            }
          }
        }
      }
    }
    else -> null
  }

  private fun serveRemote(out: OutputStream, source: Source.Remote, mimeType: String, range: String?, head: Boolean) {
    val connection = URL(source.url).openConnection() as HttpURLConnection
    try {
      connection.requestMethod = if (head) "HEAD" else "GET"
      connection.connectTimeout = 15_000
      connection.readTimeout = 30_000
      connection.setRequestProperty("User-Agent", "Lelap")
      source.headers.forEach { (k, v) -> connection.setRequestProperty(k, v) }
      range?.let { connection.setRequestProperty("Range", it) }
      val code = connection.responseCode
      val headers = mediaHeaders(mimeType).toMutableMap()
      connection.getHeaderField("Content-Length")?.let { headers["Content-Length"] = it }
      connection.getHeaderField("Content-Range")?.let { headers["Content-Range"] = it }
      writeHead(out, code, connection.responseMessage ?: "OK", headers)
      if (!head && code in 200..299) connection.inputStream.use { copy(it, out, Long.MAX_VALUE) }
    } finally {
      connection.disconnect()
    }
  }

  private fun mediaHeaders(mimeType: String): Map<String, String> = mapOf(
    "Content-Type" to mimeType,
    "Accept-Ranges" to "bytes",
    // DLNA renderers (TVs) check these before they stream.
    "transferMode.dlna.org" to "Streaming",
    "contentFeatures.dlna.org" to "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
    "Access-Control-Allow-Origin" to "*",
  )

  private fun status(out: OutputStream, code: Int, reason: String) =
    writeHead(out, code, reason, mapOf("Content-Length" to "0"))

  private fun writeHead(out: OutputStream, code: Int, reason: String, headers: Map<String, String>) {
    val head = StringBuilder("HTTP/1.1 $code $reason\r\n")
    headers.forEach { (k, v) -> head.append("$k: $v\r\n") }
    head.append("Connection: close\r\n\r\n")
    out.write(head.toString().toByteArray(Charsets.UTF_8))
    out.flush()
  }

  private fun copy(input: InputStream, out: OutputStream, limit: Long) {
    val buffer = ByteArray(64 * 1024)
    var left = limit
    while (left > 0) {
      val n = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
      if (n < 0) break
      out.write(buffer, 0, n)
      left -= n
    }
    out.flush()
  }
}
