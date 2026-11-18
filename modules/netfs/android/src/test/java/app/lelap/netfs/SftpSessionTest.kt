package app.lelap.netfs

import java.io.File
import java.io.StringWriter
import java.nio.file.Files
import java.security.KeyPair
import java.security.KeyPairGenerator
import org.apache.sshd.common.config.keys.KeyUtils
import org.apache.sshd.common.digest.BuiltinDigests
import org.apache.sshd.common.file.virtualfs.VirtualFileSystemFactory
import org.apache.sshd.server.SshServer
import org.apache.sshd.server.keyprovider.SimpleGeneratorHostKeyProvider
import org.apache.sshd.sftp.server.SftpSubsystemFactory
import org.bouncycastle.openssl.jcajce.JcaPEMWriter
import org.bouncycastle.openssl.jcajce.JcePEMEncryptorBuilder
import org.junit.After
import org.junit.AfterClass
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.BeforeClass
import org.junit.Test

/** sshj against an SFTP server inside the test run (Apache MINA SSHD). */
class SftpSessionTest {
  companion object {
    private lateinit var server: SshServer
    private lateinit var root: File
    private lateinit var userKey: KeyPair
    private lateinit var serverKey: String
    private val audio = ByteArray(300_000) { (it % 253).toByte() }

    @BeforeClass @JvmStatic fun start() {
      root = Files.createTempDirectory("lelap-sftp").toFile()
      File(root, "Books/Dune").mkdirs()
      File(root, "Books/Dune/01 Part.mp3").writeBytes(audio)
      File(root, "Books/Dune/cover.jpg").writeBytes(ByteArray(10))
      File(root, "Books/.trash").mkdirs()
      File(root, "Books/.trash/old.mp3").writeBytes(ByteArray(1))
      userKey = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
      server = SshServer.setUpDefaultServer().apply {
        host = "127.0.0.1"
        port = 0
        keyPairProvider = SimpleGeneratorHostKeyProvider(File(root.parentFile, "lelap-sftp-host-${System.nanoTime()}").toPath())
        setPasswordAuthenticator { user, password, _ -> user == "me" && password == "pw" }
        setPublickeyAuthenticator { user, key, _ -> user == "me" && KeyUtils.compareKeys(key, userKey.public) }
        subsystemFactories = listOf(SftpSubsystemFactory())
        fileSystemFactory = VirtualFileSystemFactory(root.toPath())
        start()
      }
      serverKey = KeyUtils.getFingerPrint(BuiltinDigests.sha256, server.keyPairProvider.loadKeys(null).first().public)
    }

    @AfterClass @JvmStatic fun stop() {
      server.stop(true)
      root.deleteRecursively()
    }
  }

  private val address get() = NetAddress.parse("sftp://127.0.0.1:${server.port}/Books")!!

  @After fun closePool() = Netfs.useConnector({ a, l -> if (a.scheme == NetAddress.SMB) SmbSession.connect(a, l) else SftpSession.connect(a, l) }, null)

  private fun expect(kind: NetFailure.Kind, block: () -> Unit) {
    try {
      block()
      fail("Expected $kind")
    } catch (e: NetFailure) {
      assertEquals(e.message, kind, e.kind)
    }
  }

  @Test fun showsTheHostKeyBeforeAnyLogin() {
    val key = Netfs.hostKey("sftp://127.0.0.1:${server.port}/Books")
    assertEquals(serverKey, key.fingerprint)
    assertFalse(key.algorithm.isEmpty())
  }

  @Test fun listsAndReadsRangesWithAPassword() {
    SftpSession.connect(address, NetLogin("me", password = "pw", hostKey = serverKey)).use { session ->
      val files = NetWalk.list(session, address.path).map { it.path to it.size }.sortedBy { it.first }
      assertEquals(listOf("Dune/01 Part.mp3" to 300_000L, "Dune/cover.jpg" to 10L), files)
      session.open("/Books/Dune/01 Part.mp3").use { file ->
        assertEquals(300_000L, file.length)
        val buffer = ByteArray(100)
        var got = 0
        while (got < 100) got += file.read(250_000L + got, buffer, got, 100 - got)
        assertArrayEquals(audio.copyOfRange(250_000, 250_100), buffer)
        assertEquals(-1, file.read(300_000, buffer, 0, 10))
      }
      expect(NetFailure.Kind.NOT_FOUND) { session.open("/Books/missing.mp3") }
    }
  }

  @Test fun logsInWithAPrivateKeyAndItsPassphrase() {
    val pem = StringWriter().also { w ->
      JcaPEMWriter(w).use { it.writeObject(userKey.private, JcePEMEncryptorBuilder("AES-128-CBC").build("secret".toCharArray())) }
    }.toString()
    val login = NetLogin("me", privateKey = pem, passphrase = "secret", hostKey = serverKey)
    SftpSession.connect(address, login).use { session -> assertEquals(setOf("Dune", ".trash"), session.list("/Books").map { it.name }.toSet()) }
    expect(NetFailure.Kind.PRIVATE_KEY) { SftpSession.connect(address, login.copy(passphrase = "wrong")).close() }
  }

  @Test fun refusesAChangedOrUntrustedHostKey() {
    val other = "SHA256:" + "A".repeat(43)
    expect(NetFailure.Kind.HOST_KEY_CHANGED) { SftpSession.connect(address, NetLogin("me", password = "pw", hostKey = other)).close() }
    expect(NetFailure.Kind.HOST_KEY_UNKNOWN) { SftpSession.connect(address, NetLogin("me", password = "pw")).close() }
  }

  @Test fun tellsARefusedLoginFromADeadServer() {
    expect(NetFailure.Kind.LOGIN) { SftpSession.connect(address, NetLogin("me", password = "nope", hostKey = serverKey)).close() }
    val closed = java.net.ServerSocket(0).use { it.localPort }
    expect(NetFailure.Kind.UNREACHABLE) {
      SftpSession.connect(NetAddress.parse("sftp://127.0.0.1:$closed/")!!, NetLogin("me", password = "pw", hostKey = serverKey)).close()
    }
  }

  @Test fun playsThroughThePoolAtAnyOffset() {
    val headers = mapOf(NetLogin.HEADER to """{"username":"me","password":"pw","hostKey":"$serverKey"}""")
    val uri = "sftp://127.0.0.1:${server.port}/Books/Dune/01%20Part.mp3"
    Netfs.open(uri, headers).use { opened ->
      assertArrayEquals(audio.copyOfRange(123_456, 123_556), NetBytes(opened.file).read(123_456, 100))
    }
    Netfs.open(uri, headers).use { opened ->
      assertArrayEquals(audio.copyOfRange(0, 10), NetBytes(opened.file).read(0, 10))
    }
    assertEquals(listOf("Dune/01 Part.mp3", "Dune/cover.jpg"), Netfs.list("sftp://127.0.0.1:${server.port}/Books", headers).map { it.path }.sorted())
  }
}
