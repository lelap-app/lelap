package app.lelap.audio

import java.net.InetAddress
import java.net.ServerSocket
import java.util.Base64
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HttpDigestTest {
  private fun login(user: String, password: String) =
    Base64.getEncoder().encodeToString(user.toByteArray()) + ":" + Base64.getEncoder().encodeToString(password.toByteArray())

  @Test
  fun answersRfc2617sExample() {
    val c = HttpDigest.parseChallenges(
      """Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"""",
    ).single()
    val header = HttpDigest.authorization(c, HttpDigest.Login("Mufasa", "Circle Of Life"), "GET", "/dir/index.html", 1, "0a4f113b")
    assertTrue(header, header.contains("response=\"6629fae49393a05397450978507c4ef1\""))
    assertTrue(header.contains("nc=00000001"))
    assertTrue(header.contains("opaque=\"5ccc069c403ebaf9f0171e9517f40e41\""))
  }

  @Test
  fun prefersSha256AndAnswersRfc7616sExample() {
    val nonce = "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v"
    val opaque = "FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"
    val c = HttpDigest.challenge(
      listOf(
        """Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=MD5, nonce="$nonce", opaque="$opaque"""",
        """Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=SHA-256, nonce="$nonce", opaque="$opaque", Basic realm="x"""",
      ),
    )
    assertEquals("SHA-256", c?.algorithm)
    val cnonce = "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ"
    val sha = HttpDigest.authorization(c!!, HttpDigest.Login("Mufasa", "Circle of Life"), "GET", "/dir/index.html", 1, cnonce)
    assertTrue(sha, sha.contains("response=\"753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1\""))
    val md5 = HttpDigest.parseChallenges("""Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=MD5, nonce="$nonce", opaque="$opaque"""").single()
    val answer = HttpDigest.authorization(md5, HttpDigest.Login("Mufasa", "Circle of Life"), "GET", "/dir/index.html", 1, cnonce)
    assertTrue(answer, answer.contains("response=\"8ca523f5e9506fed4657c9700eebdbec\""))
  }

  @Test
  fun sendsANameBeyondAsciiInTheExtendedForm() {
    val c = HttpDigest.parseChallenges("Digest realm=\"calibre\", nonce=\"n\", qop=\"auth\"").single()
    val header = HttpDigest.authorization(c, HttpDigest.Login("Søren", "pw"), "GET", "/opds", 1, "c")
    assertTrue(header, header.startsWith("Digest username*=UTF-8''S%C3%B8ren, "))
    assertTrue(header.all { it.code in 0x20..0x7e })
  }

  @Test
  fun readsOnlyDigestAndKnownAlgorithms() {
    assertNull(HttpDigest.challenge(listOf("Basic realm=\"calibre\"")))
    assertNull(HttpDigest.challenge(listOf("Digest realm=\"x\", nonce=\"n\", algorithm=SHA-512-256")))
    assertNotNull(HttpDigest.challenge(listOf("Basic realm=\"x\", Digest realm=\"x\", nonce=\"n\"")))
  }

  @Test
  fun takesTheLoginOutOfTheHeaders() {
    val (plain, digest) = HttpDigest.split(mapOf("X-Lelap-Digest" to login("kirsten", "blåbær"), "X-Other" to "1"))
    assertEquals(mapOf("X-Other" to "1"), plain)
    assertEquals("kirsten", digest?.username)
    assertEquals("blåbær", digest?.password)
    assertNull(HttpDigest.split(mapOf("X-Other" to "1")).second)
  }

  /** Answers 401 with a challenge until a request carries an Authorization for its own path. */
  @Test
  fun answersEachRequestForItsOwnPathAndNeverSendsTheLogin() {
    val socket = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
    val seen = mutableListOf<Pair<String, Map<String, String>>>()
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
          val auth = headers["authorization"]
          val ok = auth != null && auth.contains("uri=\"$path\"")
          val answer = if (ok) {
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
          } else {
            "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Digest realm=\"calibre\", nonce=\"abc\", qop=\"auth\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
          }
          c.getOutputStream().write(answer.toByteArray())
          c.getOutputStream().flush()
        }
      }
    }
    socket.use {
      val base = "http://127.0.0.1:${socket.localPort}"
      val headers = mapOf("X-Lelap-Digest" to login("kim", "secret"))
      val first = LoginRedirects.open("$base/get/m4b/1", headers) { it.connectTimeout = 5000; it.readTimeout = 5000 }
      assertEquals(200, first.responseCode)
      first.disconnect()
      val second = LoginRedirects.open("$base/get/m4b/2?x=1", headers) { it.connectTimeout = 5000; it.readTimeout = 5000 }
      assertEquals(200, second.responseCode)
      second.disconnect()
      val requests = synchronized(seen) { seen.toList() }
      // One refusal for the first file; the second is answered at once, with its own path.
      assertEquals(listOf("/get/m4b/1", "/get/m4b/1", "/get/m4b/2?x=1"), requests.map { it.first })
      assertTrue(requests.last().second["authorization"]!!.contains("nc=00000002"))
      assertTrue(requests.none { it.second.containsKey("x-lelap-digest") })
    }
  }
}
