package app.lelap.cast

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
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
}
