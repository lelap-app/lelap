package app.lelap.download

import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class BookMoveTest {
  private fun dir(): File = Files.createTempDirectory("move").toFile()

  private fun book(): FileFolder {
    val folder = FileFolder(dir(), BOOKKEEPING)
    File(folder.dir, "job.json").writeText("{}")
    File(folder.dir, "001.mp3").writeBytes(ByteArray(300_000) { it.toByte() })
    File(folder.dir, "002.mp3").writeBytes(ByteArray(10) { 7 })
    File(folder.dir, "cover.jpg").writeBytes(ByteArray(5) { 1 })
    return folder
  }

  @Test fun `moves every file, then deletes the originals but not the bookkeeping`() {
    val from = book()
    val to = FileFolder(dir())
    var committed = false
    assertTrue(BookMove.move(from, to, commit = { committed = true; true }))
    assertTrue(committed)
    assertEquals(mapOf("001.mp3" to 300_000L, "002.mp3" to 10L, "cover.jpg" to 5L), to.list())
    assertEquals(emptyMap<String, Long>(), from.list())
    assertTrue(File(from.dir, "job.json").isFile)
    assertEquals(File(to.dir, "001.mp3").readBytes().toList(), ByteArray(300_000) { it.toByte() }.toList())
  }

  @Test fun `a copy that breaks off keeps every original and the old place`() {
    val from = book()
    // Fails after 100 kB: a full SD card or one pulled out mid-copy.
    val real = FileFolder(dir())
    val to = object : BookFolder by real {
      override fun output(name: String, append: Boolean): OutputStream {
        val inner = real.output(name, append)
        return object : OutputStream() {
          var written = 0
          override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)
          override fun write(b: ByteArray, off: Int, len: Int) {
            written += len
            if (written > 100_000) throw IOException("No space left")
            inner.write(b, off, len)
          }
          override fun close() = inner.close()
        }
      }
    }
    var committed = false
    try {
      BookMove.move(from, to, commit = { committed = true; true })
      fail("the move should stop")
    } catch (e: IOException) {
      assertEquals("No space left", e.message)
    }
    assertFalse(committed)
    assertEquals(setOf("001.mp3", "002.mp3", "cover.jpg"), from.list().keys)
    assertNull(to.length("001.mp3"))
  }

  @Test fun `a second run after a stop skips finished copies and replaces a half one`() {
    val from = book()
    val to = FileFolder(dir())
    File(to.dir, "002.mp3").writeBytes(ByteArray(10) { 7 })
    File(to.dir, "001.mp3.move").writeBytes(ByteArray(42))
    assertTrue(BookMove.move(from, to, commit = { true }))
    assertEquals(mapOf("001.mp3" to 300_000L, "002.mp3" to 10L, "cover.jpg" to 5L), to.list())
  }

  @Test fun `a copy that comes out short is never given the file's name`() {
    val from = book()
    val to = object : BookFolder by FileFolder(dir()) {
      override fun length(name: String): Long? = if (name.endsWith(BookMove.COPY_SUFFIX)) 1L else null
      override fun list(): Map<String, Long> = emptyMap()
    }
    try {
      BookMove.move(from, to, commit = { true })
      fail("the move should stop")
    } catch (e: IOException) {
      assertTrue(e.message!!.contains("wrong size"))
    }
    assertEquals(setOf("001.mp3", "002.mp3", "cover.jpg"), from.list().keys)
  }

  @Test fun `a book removed during the move keeps nothing in the new place`() {
    val from = book()
    val to = FileFolder(dir())
    assertFalse(BookMove.move(from, to, commit = { false }))
    assertEquals(emptyMap<String, Long>(), to.list())
    // The originals are not the move's to delete; removing the book does that.
    assertEquals(3, from.list().size)
  }
}

class LocationRulesTest {
  @Test fun `reads the volume and path of a tree`() {
    assertEquals("primary", LocationRules.volumeOf("primary:Audiobooks/Lelap"))
    assertEquals("1A2B-3C4D", LocationRules.volumeOf("1A2B-3C4D:"))
    assertNull(LocationRules.volumeOf("odd"))
    assertEquals("Audiobooks/Lelap", LocationRules.pathOf("primary:Audiobooks/Lelap"))
    assertEquals("", LocationRules.pathOf("1A2B-3C4D:"))
  }

  @Test fun `moves a book only when it is elsewhere and not downloading`() {
    val sd = "content://tree/sd"
    assertTrue(LocationRules.shouldMove(null, sd, WorkState.SUCCEEDED))
    assertTrue(LocationRules.shouldMove(sd, null, WorkState.FAILED))
    assertTrue(LocationRules.shouldMove(null, sd, WorkState.NONE))
    assertFalse(LocationRules.shouldMove(sd, sd, WorkState.SUCCEEDED))
    for (busy in listOf(WorkState.RUNNING, WorkState.ENQUEUED, WorkState.BLOCKED)) {
      assertFalse(busy.name, LocationRules.shouldMove(null, sd, busy))
    }
  }
}
