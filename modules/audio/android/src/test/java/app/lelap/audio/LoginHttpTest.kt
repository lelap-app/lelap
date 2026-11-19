package app.lelap.audio

import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LoginHttpTest {
  /** A one-request-at-a-time HTTP server that records each request's path and headers. */
  private class Server(private val answer: (path: String, headers: Map<String, String>) -> String) : AutoCloseable {
    private val socket = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
    val port get() = socket.localPort
    val seen = mutableListOf<Pair<String, Map<String, String>>>()

    init {
      thread(isDaemon = true) {
        while (!socket.isClosed) {
          val client = runCatching { socket.accept() }.getOrNull() ?: break
          client.use { c ->
            val reader = c.getInputStream().bufferedReader()
            val path = reader.readLine()?.split(" ")?.getOrNull(1) ?: return@use
            val headers = mutableMapOf<String, String>()
            while (true) {
              val line = reader.readLine() ?: break
              if (line.isEmpty()) break
              val colon = line.indexOf(':')
              if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
            }
            synchronized(seen) { seen.add(path to headers) }
            c.getOutputStream().write(answer(path, headers).toByteArray())
            c.getOutputStream().flush()
          }
        }
      }
    }

    override fun close() = socket.close()
  }

  private val file = "0123456789"

  private fun ok(body: String) = "HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body"

  /** Answers a Range header with the bytes it names, as a server that takes ranges does. */
  private fun ranged(headers: Map<String, String>): String {
    val range = headers["range"] ?: return ok(file)
    val (from, to) = Regex("""bytes=(\d+)-(\d*)""").find(range)!!.destructured
    val last = if (to.isEmpty()) file.length - 1 else to.toInt()
    val body = file.substring(from.toInt(), last + 1)
    return "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes $from-$last/${file.length}\r\n" +
      "Content-Length: ${body.length}\r\nConnection: close\r\n\r\n$body"
  }

  private fun LoginHttp.Answer.text(): String = stream!!.readBytes().decodeToString().also { connection.disconnect() }

  @Test
  fun namesTheRangeAndReadsItsLength() {
    assertNull(LoginHttp.range(0, -1))
    assertEquals("bytes=5-", LoginHttp.range(5, -1))
    assertEquals("bytes=2-4", LoginHttp.range(2, 3))
    assertEquals(3L, LoginHttp.contentLength("10", "bytes 2-4/10"))
    assertEquals(10L, LoginHttp.contentLength("10", null))
    assertEquals(-1L, LoginHttp.contentLength(null, null))
    assertEquals(10L, LoginHttp.documentSize("bytes */10"))
    assertEquals(-1L, LoginHttp.documentSize(null))
  }

  @Test
  fun readsFromThePositionAskedFor() {
    Server { _, headers -> ranged(headers) }.use { server ->
      val answer = LoginHttp.open("http://127.0.0.1:${server.port}/a.mp3", mapOf("X-Api-Key" to "secret"), emptyMap(), 4, -1)
      assertEquals(206, answer.status)
      assertEquals(6L, answer.length)
      assertEquals("456789", answer.text())
      assertEquals("secret", server.seen[0].second["x-api-key"])
      assertEquals("identity", server.seen[0].second["accept-encoding"])
    }
  }

  @Test
  fun skipsToThePositionWhenTheServerSendsTheWholeFile() {
    Server { _, _ -> ok(file) }.use { server ->
      val answer = LoginHttp.open("http://127.0.0.1:${server.port}/a.mp3", emptyMap(), emptyMap(), 7, -1)
      assertEquals(200, answer.status)
      assertEquals(3L, answer.length)
      assertEquals("789", answer.text())
    }
  }

  @Test
  fun followsEachRequestsOwnRedirectAndKeepsTheLoginHome() {
    val links = AtomicInteger()
    Server { _, headers -> ranged(headers) }.use { elsewhere ->
      Server { path, _ ->
        // A fresh signed link on another host each time, as a server that hands out expiring links does.
        val target = if (path == "/book/a.mp3") "/moved/a.mp3" else "http://127.0.0.1:${elsewhere.port}/signed/${links.incrementAndGet()}"
        "HTTP/1.1 302 Found\r\nLocation: $target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
      }.use { home ->
        val url = "http://127.0.0.1:${home.port}/book/a.mp3"
        val login = mapOf("X-Api-Key" to "secret")
        val first = LoginHttp.open(url, login, mapOf("Icy-MetaData" to "1"), 0, 4)
        assertEquals("0123", first.text())
        val second = LoginHttp.open(url, login, emptyMap(), 6, -1)
        assertEquals("6789", second.text())
        assertEquals("http://127.0.0.1:${elsewhere.port}/signed/2", second.url)
        // Both hops on the file's own server carried the login, on each request.
        assertEquals(listOf("secret", "secret", "secret", "secret"), synchronized(home.seen) { home.seen.map { it.second["x-api-key"] } })
        // The other host got each request's own link, its range and Media3's headers, never the login.
        val signed = synchronized(elsewhere.seen) { elsewhere.seen.toList() }
        assertEquals(listOf("/signed/1", "/signed/2"), signed.map { it.first })
        assertEquals(listOf(null, null), signed.map { it.second["x-api-key"] })
        assertEquals("bytes=0-3", signed[0].second["range"])
        assertEquals("1", signed[0].second["icy-metadata"])
      }
    }
  }

  @Test
  fun handsBackAStatusThatIsNotASuccess() {
    Server { _, _ -> "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n" }.use { server ->
      val answer = LoginHttp.open("http://127.0.0.1:${server.port}/a.mp3", emptyMap(), emptyMap(), 0, -1)
      assertEquals(403, answer.status)
      assertNull(answer.stream)
      answer.connection.disconnect()
    }
  }
}
