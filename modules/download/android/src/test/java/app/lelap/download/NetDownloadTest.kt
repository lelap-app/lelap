package app.lelap.download

import app.lelap.netfs.NetAddress
import app.lelap.netfs.NetEntry
import app.lelap.netfs.NetFailure
import app.lelap.netfs.NetFile
import app.lelap.netfs.NetLogin
import app.lelap.netfs.NetSession
import app.lelap.netfs.Netfs
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class NetDownloadTest {
  private val data = ByteArray(200_000) { (it % 241).toByte() }
  private var reads = mutableListOf<Long>()
  private var refuse = false
  private val headers = mapOf(NetLogin.HEADER to """{"username":"me","password":"pw"}""")
  private val url = "smb://nas/Share/Dune/01.mp3"

  private val session = object : NetSession {
    override val alive = true
    override fun list(path: String) = emptyList<NetEntry>()
    override fun stat(path: String) = NetEntry("01.mp3", false, data.size.toLong(), 0)
    override fun open(path: String): NetFile {
      if (refuse) throw NetFailure(NetFailure.Kind.LOGIN, "refused")
      return object : NetFile {
        override val length = data.size.toLong()
        override fun read(position: Long, buffer: ByteArray, offset: Int, length: Int): Int {
          reads += position
          if (position >= data.size) return -1
          val n = minOf(length, data.size - position.toInt())
          System.arraycopy(data, position.toInt(), buffer, offset, n)
          return n
        }
        override fun close() = Unit
      }
    }
    override fun close() = Unit
  }

  init {
    Netfs.useConnector({ _: NetAddress, _: NetLogin -> session })
  }

  @After fun reset() = Netfs.useConnector({ _, _ -> throw NetFailure(NetFailure.Kind.UNREACHABLE, "none") })

  private val folder = FileFolder(Files.createTempDirectory("lelap-net").toFile())

  @Test fun continuesAPartFileFromWhereItStopped() = runBlocking {
    folder.output("01.mp3.part", append = false).use { it.write(data, 0, 150_000) }
    NetDownload.fetch(url, folder, "01.mp3", headers, { it.message.orEmpty() }) {}
    assertEquals(150_000L, reads.first())
    assertArrayEquals(data, folder.input("01.mp3").readBytes())
    assertNull(folder.length("01.mp3.part"))
  }

  @Test fun aPartFileLongerThanTheFileStartsAgain() = runBlocking {
    folder.output("01.mp3.part", append = false).use { it.write(ByteArray(300_000)) }
    NetDownload.fetch(url, folder, "01.mp3", headers, { it.message.orEmpty() }) {}
    assertEquals(0L, reads.first())
    assertArrayEquals(data, folder.input("01.mp3").readBytes())
  }

  @Test fun aRefusedLoginIsNotTriedAgain() = runBlocking {
    refuse = true
    try {
      NetDownload.fetch(url, folder, "01.mp3", headers, { "Log in again." }) {}
      fail()
    } catch (e: PermanentFailure) {
      assertEquals("Log in again.", e.message)
    }
  }
}
