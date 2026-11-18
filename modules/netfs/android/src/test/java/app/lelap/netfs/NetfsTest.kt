package app.lelap.netfs

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NetAddressTest {
  @Test fun readsTheAddressesTheAppBuilds() {
    // As `netRootUri` and `netfsListed` in @lelap/core write them.
    val smb = NetAddress.parse("smb://nas.local/Media/Audio%20Books/Dune%20%231/01%20Part%3F%2B.mp3")!!
    assertEquals("smb", smb.scheme)
    assertEquals(445, smb.port)
    assertEquals("Media", smb.share)
    assertEquals("Audio Books/Dune #1/01 Part?+.mp3", smb.path)

    val sftp = NetAddress.parse("sftp://[fd00::2]:2222/home/me/Books/")!!
    assertEquals("fd00::2", sftp.host)
    assertEquals(2222, sftp.port)
    assertNull(sftp.share)
    assertEquals("/home/me/Books", sftp.path)
    assertEquals("/", NetAddress.parse("sftp://host/")!!.path)
    assertEquals("", NetAddress.parse("smb://nas/Share/")!!.path)
  }

  @Test fun refusesAnythingElse() {
    assertNull(NetAddress.parse("https://nas.local/x"))
    assertNull(NetAddress.parse("smb://nas.local"))
    assertNull(NetAddress.parse("smb://nas/Share/../etc"))
    assertNull(NetAddress.parse("sftp://host/a/%2E%2E/b"))
    assertNull(NetAddress.parse("sftp://host/a%2Fb"))
    assertNull(NetAddress.parse("sftp://host:0/a"))
    assertFalse(NetAddress.handles("file:///sdcard/a.mp3"))
    assertTrue(NetAddress.handles("SMB://nas/Share"))
  }
}

class NetLoginTest {
  @Test fun readsTheHeaderAndKeepsSecretsOutOfLogs() {
    val login = NetLogin.fromHeaders(
      mapOf("x-lelap-netfs" to """{"username":"OFFICE\\me","password":"hunter2","hostKey":"SHA256:abc"}"""),
    )!!
    assertEquals("OFFICE", login.domain)
    assertEquals("me", login.user)
    assertEquals("hunter2", login.password)
    assertNull(login.privateKey)
    assertFalse(login.toString().contains("hunter2"))
    assertNull(NetLogin.fromHeaders(mapOf("Authorization" to "Basic x")))
    assertNull(NetLogin.decode("not json"))
    assertTrue(login.fingerprint != login.copy(password = "other").fingerprint)
  }
}

class HostKeysTest {
  @Test fun fingerprintsLikeOpenSsh() {
    // `ssh-keygen -lf` on this key printed SHA256:k2FijMvtKwvEN7rYpPesJE6X4qN9EsqE7Xlhm5HWm0w.
    val blob = java.util.Base64.getDecoder().decode("AAAAC3NzaC1lZDI1NTE5AAAAIHmW3FH18/p6HXeMlBQDzzkScnmASCZC5klxM4c7hxt7")
    assertEquals("SHA256:k2FijMvtKwvEN7rYpPesJE6X4qN9EsqE7Xlhm5HWm0w", HostKeys.fingerprint(blob))
  }

  @Test fun trustsOnlyTheStoredKey() {
    val key = "SHA256:k2FijMvtKwvEN7rYpPesJE6X4qN9EsqE7Xlhm5HWm0w"
    assertEquals(HostKeys.Verdict.TRUSTED, HostKeys.check(key, key))
    assertEquals(HostKeys.Verdict.TRUSTED, HostKeys.check("sha256:k2FijMvtKwvEN7rYpPesJE6X4qN9EsqE7Xlhm5HWm0w=", key))
    assertEquals(HostKeys.Verdict.CHANGED, HostKeys.check(key, "SHA256:K2FijMvtKwvEN7rYpPesJE6X4qN9EsqE7Xlhm5HWm0w"))
    assertEquals(HostKeys.Verdict.NOT_TRUSTED_YET, HostKeys.check(null, key))
    assertEquals(HostKeys.Verdict.NOT_TRUSTED_YET, HostKeys.check(" ", key))
  }
}

class NetWalkTest {
  private val server = FakeServer(
    mapOf(
      "Dune/01.mp3" to ByteArray(10),
      "Dune/02.mp3" to ByteArray(20),
      "Dune/cover.jpg" to ByteArray(5),
      "Dune/@eaDir/01.mp3/SYNOPHOTO_THUMB.jpg" to ByteArray(1),
      "#recycle/old.mp3" to ByteArray(1),
      ".hidden/x.mp3" to ByteArray(1),
      "Series/Book 1/a.m4b" to ByteArray(30),
      "loose.mp3" to ByteArray(7),
    ),
    links = mapOf("Linked" to "Series", "Broken" to "Nowhere"),
  )

  @Test fun listsEveryFileBelowTheFolderAndSkipsWhatTheNasKeeps() {
    val files = NetWalk.list(server.session(), "").map { it.path to it.size }.sortedBy { it.first }
    assertEquals(
      listOf(
        "Dune/01.mp3" to 10L,
        "Dune/02.mp3" to 20L,
        "Dune/cover.jpg" to 5L,
        "Linked/Book 1/a.m4b" to 30L,
        "Series/Book 1/a.m4b" to 30L,
        "loose.mp3" to 7L,
      ),
      files,
    )
  }

  @Test fun stopsAtTheBounds() {
    assertEquals(listOf("loose.mp3"), NetWalk.list(server.session(), "", maxFolders = 1).map { it.path })
    val shallow = NetWalk.list(server.session(), "", maxDepth = 2).map { it.path }
    assertFalse(shallow.any { it.startsWith("Series/Book 1/") })
    assertTrue("Dune/01.mp3" in shallow)
  }

  @Test fun leavesOutAFolderThisLoginCannotRead() {
    val locked = FakeServer(mapOf("Open/a.mp3" to ByteArray(1), "Private/b.mp3" to ByteArray(1)), denied = setOf("Private"))
    assertEquals(listOf("Open/a.mp3"), NetWalk.list(locked.session(), "").map { it.path })
    try {
      NetWalk.list(locked.session(), "Private")
      fail()
    } catch (e: NetFailure) {
      assertEquals(NetFailure.Kind.DENIED, e.kind)
    }
  }

  @Test fun startsBelowAFolderAndFailsForAMissingOne() {
    assertEquals(listOf("Book 1/a.m4b"), NetWalk.list(server.session(), "Series").map { it.path })
    try {
      NetWalk.list(server.session(), "Gone")
      fail()
    } catch (e: NetFailure) {
      assertEquals(NetFailure.Kind.NOT_FOUND, e.kind)
    }
  }
}

class NetBytesTest {
  @Test fun readsRangesAcrossBlocksAndStopsAtTheEnd() {
    val data = ByteArray(200_000) { (it % 251).toByte() }
    val server = FakeServer(mapOf("a.mp3" to data))
    val file = server.session().open("a.mp3")
    val bytes = NetBytes(file)
    assertEquals(200_000L, bytes.size)
    assertArrayEquals(data.copyOfRange(65_530, 65_550), bytes.read(65_530, 20))
    assertArrayEquals(data.copyOfRange(199_990, 200_000), bytes.read(199_990, 100))
    assertEquals(0, bytes.read(300_000, 10).size)
    // Small reads in one block cost one request.
    val before = server.reads.size
    repeat(100) { bytes.read(70_000L + it, 1) }
    assertEquals(before, server.reads.size)
  }

  @Test fun readsAheadSoSmallReadsCostOneRequest() {
    val data = ByteArray(600_000) { (it % 249).toByte() }
    val server = FakeServer(mapOf("a.mp3" to data))
    val ahead = ReadAhead(server.session().open("a.mp3"), bufferSize = 40_000)
    val out = ByteArray(400)
    var position = 10_000L
    repeat(90) {
      val n = ahead.read(position, out, 0, 400)
      assertArrayEquals(data.copyOfRange(position.toInt(), position.toInt() + n), out.copyOf(n))
      position += n
    }
    // 36 KB in 400-byte reads: one request for the first 40 KB.
    assertEquals(1, server.reads.size)
    assertEquals(-1, ahead.read(600_000, out, 0, 400))
  }

  @Test fun streamsFromAnOffset() {
    val data = ByteArray(1_000) { it.toByte() }
    val file = FakeServer(mapOf("a" to data)).session().open("a")
    val stream = NetInputStream(file, 990)
    assertArrayEquals(data.copyOfRange(990, 1_000), stream.readBytes())
    assertEquals(-1, stream.read())
  }
}

class SessionPoolTest {
  private var now = 0L
  private val server = FakeServer(mapOf("a.mp3" to ByteArray(10)))
  private val pool = SessionPool({ _, _ -> server.session() }, idleMs = 60_000, clock = { now }, sweepEveryMs = null)
  private val address = NetAddress.parse("smb://nas/Share/a.mp3")!!
  private val login = NetLogin("me", password = "pw")

  @After fun close() = pool.closeAll()

  @Test fun sharesAConnectionAndClosesItWhenIdle() {
    val a = pool.lease(address, login)
    val b = pool.lease(address, login)
    assertEquals(1, server.opened.get())
    a.close()
    b.close()
    now = 59_000
    pool.sweep()
    assertEquals(1, pool.open)
    pool.use(address, login) { it.list("") }
    now = 119_500
    pool.sweep()
    assertEquals(0, pool.open)
    assertEquals(1, server.closed.get())
  }

  @Test fun keepsNoHandshakeGateOnceNobodyWaits() {
    pool.lease(address, login).close()
    pool.lease(address, login.copy(password = "other")).close()
    runCatching { pool.use(address, login) { throw java.io.IOException("reset") } }
    assertEquals(0, pool.gates)
  }

  @Test fun anotherLoginGetsItsOwnConnection() {
    pool.lease(address, login).close()
    pool.lease(address, login.copy(password = "other")).close()
    assertEquals(2, server.opened.get())
  }

  @Test fun aBrokenConnectionIsClosedAndReplaced() {
    try {
      pool.use(address, login) { throw java.io.IOException("reset") }
      fail()
    } catch (e: java.io.IOException) {
      assertEquals("reset", e.message)
    }
    assertEquals(0, pool.open)
    assertEquals(1, server.closed.get())
    // A missing file says nothing about the connection.
    runCatching { pool.use(address, login) { it.open("gone.mp3") } }
    assertEquals(1, pool.open)
  }

  @Test fun aRefusedLoginIsNotTriedAgainForAWhile() {
    var tries = 0
    val refusing = SessionPool({ _, _ -> tries++; throw NetFailure(NetFailure.Kind.LOGIN, "no") }, clock = { now }, sweepEveryMs = null)
    repeat(3) { runCatching { refusing.lease(address, login) } }
    assertEquals(1, tries)
    now = 6 * 60_000
    runCatching { refusing.lease(address, login) }
    assertEquals(2, tries)
  }

  @Test fun aSeekThatInterruptsAReadKeepsTheConnection() {
    runCatching { pool.use(address, login) { throw java.io.InterruptedIOException() } }
    assertEquals(1, pool.open)
  }

  @Test fun closesNothingStillInUse() {
    val lease = pool.lease(address, login)
    now = 600_000
    pool.sweep()
    assertEquals(1, pool.open)
    lease.broken()
    lease.close()
    assertEquals(0, pool.open)
    assertEquals(1, server.closed.get())
  }
}

class NetfsTest {
  private val data = ByteArray(100_000) { (it * 7).toByte() }
  private val server = FakeServer(mapOf("Books/Dune/01 Part.mp3" to data))
  private val headers = mapOf(NetLogin.HEADER to """{"username":"me","password":"pw"}""")

  @After fun reset() = Netfs.useConnector({ a, l -> if (a.scheme == NetAddress.SMB) SmbSession.connect(a, l) else SftpSession.connect(a, l) }, null)

  @Test fun opensAtAnOffsetAndGivesTheConnectionBack() {
    Netfs.useConnector({ _, _ -> server.session() })
    Netfs.open("smb://nas/Share/Books/Dune/01%20Part.mp3", headers).use { opened ->
      val buffer = ByteArray(10)
      assertEquals(10, opened.file.read(50_000, buffer, 0, 10))
      assertArrayEquals(data.copyOfRange(50_000, 50_010), buffer)
    }
    val (length, open) = Netfs.opener("smb://nas/Share/Books/Dune/01%20Part.mp3", headers)
    assertEquals(100_000L, length)
    open(99_995).use { assertArrayEquals(data.copyOfRange(99_995, 100_000), it.readBytes()) }
    assertEquals(1, server.opened.get())
    assertEquals(listOf("Dune/01 Part.mp3"), Netfs.list("smb://nas/Share/Books/", headers).map { it.path })
  }

  @Test fun refusesWithoutALogin() {
    Netfs.useConnector({ _, _ -> server.session() })
    try {
      Netfs.open("smb://nas/Share/Books/Dune/01%20Part.mp3", emptyMap())
      fail()
    } catch (e: NetFailure) {
      assertEquals(NetFailure.Kind.LOGIN, e.kind)
    }
    assertEquals(0, server.opened.get())
  }
}
