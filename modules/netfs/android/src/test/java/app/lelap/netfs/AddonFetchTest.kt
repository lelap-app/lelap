package app.lelap.netfs

import java.net.InetAddress
import okhttp3.Dns
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AddonFetchTest {
  private lateinit var server: MockWebServer

  @Before
  fun start() {
    server = MockWebServer()
    server.start(InetAddress.getByName("127.0.0.1"), 0)
  }

  @After
  fun stop() = server.shutdown()

  private fun at(path: String) = "http://127.0.0.1:${server.port}$path"

  private fun fetch(
    url: String,
    localNetwork: Boolean,
    maxBytes: Long = 1_000,
    dns: Dns = Dns.SYSTEM,
  ) = AddonFetch(dns).fetch(url, "GET", mapOf("X-Token" to "t"), null, 5_000, maxBytes, localNetwork)

  @Test
  fun tellsPublicAddressesFromTheHomeNetwork() {
    val public = listOf("93.184.216.34", "2606:2800:220:1::1", "64:ff9b::5db8:d822", "8.8.8.8")
    val private = listOf(
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
      "0.0.0.0", "224.0.0.251", "::1", "::", "fd00::1", "fe80::1", "ff02::fb",
      "::ffff:192.168.1.1", "64:ff9b::c0a8:0101", "2002:c0a8:0101::1",
    )
    for (a in public) assertTrue(a, AddonFetch.isPublic(InetAddress.getByName(a)))
    for (a in private) assertFalse(a, AddonFetch.isPublic(InetAddress.getByName(a)))
  }

  @Test
  fun readsIpLiteralsOnly() {
    assertEquals(InetAddress.getByName("::1"), AddonFetch.literal("[::1]"))
    assertEquals(InetAddress.getByName("10.0.0.1"), AddonFetch.literal("10.0.0.1"))
    assertNull(AddonFetch.literal("nas.local"))
  }

  @Test
  fun refusesADeclaredHostOnTheHomeNetwork() {
    server.enqueue(MockResponse().setBody("router"))
    // Written as an address, and a name that resolves to one.
    assertThrows(PrivateAddressException::class.java) { fetch(at("/"), localNetwork = false) }
    val rebinding = object : Dns {
      override fun lookup(hostname: String) = listOf(InetAddress.getByName("127.0.0.1"))
    }
    assertThrows(PrivateAddressException::class.java) {
      fetch("http://api.example:${server.port}/", localNetwork = false, dns = rebinding)
    }
    assertEquals(0, server.requestCount)
  }

  @Test
  fun reachesAnAddressTheListenerTyped() {
    server.enqueue(
      MockResponse()
        .setBody("ok")
        .addHeader("Content-Type", "text/plain; charset=utf-8")
        .addHeader("Set-Cookie", "a=1")
        .addHeader("Set-Cookie", "b=2")
        .addHeader("X-Secret", "hidden"),
    )
    val answer = fetch(at("/"), localNetwork = true)
    assertEquals(200, answer.status)
    assertEquals("ok", answer.text)
    assertEquals("a=1, b=2", answer.headers["set-cookie"])
    assertEquals("text/plain; charset=utf-8", answer.headers["content-type"])
    assertNull(answer.headers["x-secret"])
    assertEquals("t", server.takeRequest().getHeader("X-Token"))
  }

  @Test
  fun neitherFollowsRedirectsNorSendsCookies() {
    server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "/other").addHeader("Set-Cookie", "s=1"))
    server.enqueue(MockResponse().setBody("second"))
    val fetcher = AddonFetch()
    val first = fetcher.fetch(at("/"), "GET", emptyMap(), null, 5_000, 1_000, true)
    assertEquals(302, first.status)
    fetcher.fetch(at("/again"), "GET", emptyMap(), null, 5_000, 1_000, true)
    server.takeRequest()
    val again = server.takeRequest()
    assertEquals("/again", again.path)
    assertNull(again.getHeader("Cookie"))
  }

  @Test
  fun refusesAnAnswerOverTheCap() {
    server.enqueue(MockResponse().setBody("x".repeat(2_000)))
    assertThrows(TooLargeException::class.java) { fetch(at("/"), localNetwork = true) }
    // Without a length, too: the body is read only one byte past the cap.
    server.enqueue(MockResponse().setChunkedBody("y".repeat(2_000), 100))
    assertThrows(TooLargeException::class.java) { fetch(at("/"), localNetwork = true) }
  }
}
