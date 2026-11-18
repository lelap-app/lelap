package app.lelap.cast

import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoginRedirectsTest {
  /** A one-request-at-a-time HTTP server that records each request's headers. */
  private class Server(private val answer: (path: String) -> String) : AutoCloseable {
    private val socket = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
    val port get() = socket.localPort
    val seen = mutableListOf<Map<String, String>>()

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
            synchronized(seen) { seen.add(headers) }
            c.getOutputStream().write(answer(path).toByteArray())
            c.getOutputStream().flush()
          }
        }
      }
    }

    override fun close() = socket.close()
  }

  @Test
  fun aServerIsSchemeHostAndPort() {
    val origin = URL("http://nas.local/books/a.mp3")
    assertTrue(LoginRedirects.sameServer(origin, URL("http://NAS.local:80/other.mp3")))
    assertFalse(LoginRedirects.sameServer(origin, URL("https://nas.local/books/a.mp3")))
    assertFalse(LoginRedirects.sameServer(origin, URL("http://nas.local:8080/books/a.mp3")))
    assertFalse(LoginRedirects.sameServer(origin, URL("http://cdn.example/books/a.mp3")))
  }

  @Test
  fun dropsTheLoginWhenARedirectLeavesTheServer() {
    Server { "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok" }.use { elsewhere ->
      Server { path ->
        val target = if (path == "/a") "/b" else "http://127.0.0.1:${elsewhere.port}/c"
        "HTTP/1.1 302 Found\r\nLocation: $target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
      }.use { home ->
        val (final, same) = LoginRedirects.resolve("http://127.0.0.1:${home.port}/a", mapOf("X-Api-Key" to "secret"))
        // Both hops on the first server carried the login; the other server never saw it.
        assertEquals(listOf("secret", "secret"), synchronized(home.seen) { home.seen.map { it["x-api-key"] } })
        assertEquals(1, elsewhere.seen.size)
        assertNull(elsewhere.seen[0]["x-api-key"])
        assertEquals("http://127.0.0.1:${elsewhere.port}/c", final)
        assertFalse(same)
      }
    }
  }
}
