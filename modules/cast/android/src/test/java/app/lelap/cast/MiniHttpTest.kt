package app.lelap.cast

import java.io.ByteArrayInputStream
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MiniHttpTest {
  @Test
  fun readsContentLengthBodies() {
    val r = MiniHttp.read(ByteArrayInputStream("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello trailing".toByteArray()))
    assertEquals(200, r.status)
    assertEquals("hello", r.text())
  }

  @Test
  fun readsChunkedBodies() {
    val raw = "HTTP/1.1 500 Internal Server Error\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nWiki\r\n5;x=y\r\npedia\r\n0\r\n\r\n"
    val r = MiniHttp.read(ByteArrayInputStream(raw.toByteArray()))
    assertEquals(500, r.status)
    assertEquals("Wikipedia", r.text())
  }

  @Test
  fun readsToTheEndWithoutALength() {
    val r = MiniHttp.read(ByteArrayInputStream("HTTP/1.0 200 OK\nServer: x\n\n<root/>".toByteArray()))
    assertEquals("x", r.headers["server"])
    assertEquals("<root/>", r.text())
  }

  @Test
  fun refusesEndlessHeadersAndSlowSenders() {
    val many = (1..MiniHttp.MAX_HEADERS + 1).joinToString("") { "X-$it: y\r\n" } + "\r\n"
    assertThrows(IOException::class.java) { MiniHttp.readHeaders(ByteArrayInputStream(many.toByteArray())) }
    val big = (1..40).joinToString("") { "X-$it: ${"y".repeat(1000)}\r\n" } + "\r\n"
    assertThrows(IOException::class.java) { MiniHttp.readHeaders(ByteArrayInputStream(big.toByteArray())) }
    val late = System.nanoTime() - 1
    assertThrows(IOException::class.java) { MiniHttp.readLine(ByteArrayInputStream("GET / HTTP/1.1\r\n".toByteArray()), late) }
    assertEquals(MiniHttp.MAX_HEADERS, MiniHttp.readHeaders(ByteArrayInputStream(many.substringAfter("\r\n").toByteArray())).size)
  }
}
