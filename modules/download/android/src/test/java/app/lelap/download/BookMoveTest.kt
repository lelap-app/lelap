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

  private val parts = mapOf("001.mp3" to 300_000L, "002.mp3" to 10L, "cover.jpg" to 5L)

  private fun book(): FileFolder {
    val folder = FileFolder(dir(), BOOKKEEPING)
    File(folder.dir, "job.json").writeText("{}")
    File(folder.dir, "001.mp3").writeBytes(ByteArray(300_000) { it.toByte() })
    File(folder.dir, "002.mp3").writeBytes(ByteArray(10) { 7 })
    File(folder.dir, "cover.jpg").writeBytes(ByteArray(5) { 1 })
    return folder
  }

  @Test fun `copies every file and keeps the originals and the bookkeeping`() {
    val from = book()
    val to = FileFolder(dir())
    assertEquals(parts.keys, BookMove.copy(from, to).toSet())
    assertEquals(parts, to.list())
    assertEquals(parts, from.list())
    assertTrue(File(from.dir, "job.json").isFile)
    assertEquals(File(to.dir, "001.mp3").readBytes().toList(), ByteArray(300_000) { it.toByte() }.toList())
  }

  @Test fun `a copy that breaks off leaves no file under its own name`() {
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
    try {
      BookMove.copy(from, to)
      fail("the copy should stop")
    } catch (e: IOException) {
      assertEquals("No space left", e.message)
    }
    assertEquals(parts, from.list())
    assertNull(to.length("001.mp3"))
  }

  @Test fun `a second run after a stop skips finished copies and replaces a half one`() {
    val from = book()
    val to = FileFolder(dir())
    File(to.dir, "002.mp3").writeBytes(ByteArray(10) { 7 })
    File(to.dir, "001.mp3.move").writeBytes(ByteArray(42))
    BookMove.copy(from, to)
    assertEquals(parts, to.list())
  }

  @Test fun `clears the half copies a crash left and says when the folder is then empty`() {
    val folder = FileFolder(dir())
    File(folder.dir, "001.mp3").writeBytes(ByteArray(10))
    File(folder.dir, "002.mp3.move").writeBytes(ByteArray(42))
    assertFalse(BookMove.clearLeftovers(folder))
    assertEquals(mapOf("001.mp3" to 10L), folder.list())

    val onlyHalf = FileFolder(dir())
    File(onlyHalf.dir, "001.mp3.move").writeBytes(ByteArray(42))
    assertTrue(BookMove.clearLeftovers(onlyHalf))
    assertEquals(emptyMap<String, Long>(), onlyHalf.list())
  }

  @Test fun `keeps the move note out of the book's files`() {
    val from = book()
    File(from.dir, "moving.txt").writeText("content://tree/sd")
    assertEquals(parts, from.list())
  }

  @Test fun `a copy that comes out short is never given the file's name`() {
    val from = book()
    val to = object : BookFolder by FileFolder(dir()) {
      override fun length(name: String): Long? = if (name.endsWith(BookMove.COPY_SUFFIX)) 1L else null
      override fun list(): Map<String, Long> = emptyMap()
    }
    try {
      BookMove.copy(from, to)
      fail("the copy should stop")
    } catch (e: IOException) {
      assertTrue(e.message!!.contains("wrong size"))
    }
    assertEquals(parts, from.list())
  }
}

class OldCopiesTest {
  private val card = "content://com.android.externalstorage.documents/tree/1A2B-3C4D%3A"

  @Test fun `round-trips and drops unsafe names`() {
    val copies = listOf(OldCopy(null, listOf("001.mp3", "cover.jpg")), OldCopy(card, listOf("002.mp3")))
    assertEquals(copies, OldCopies.decode(OldCopies.encode(copies)))
    assertEquals(
      listOf(OldCopy(null, listOf("001.mp3"))),
      OldCopies.decode("""[{"location":null,"names":["001.mp3","../job.json"]}]"""),
    )
    assertEquals(emptyList<OldCopy>(), OldCopies.decode("{"))
    assertEquals(emptyList<OldCopy>(), OldCopies.decode(null))
  }

  @Test fun `never deletes copies in the place the book lives in`() {
    val inPrivate = OldCopy(null, listOf("001.mp3"))
    val onCard = OldCopy(card, listOf("001.mp3"))
    assertEquals(listOf(inPrivate), OldCopies.deletable(listOf(inPrivate, onCard), card))
    // Moved to the card and back: the private copy is the live one again.
    assertEquals(listOf(onCard), OldCopies.deletable(listOf(inPrivate, onCard), null))
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
