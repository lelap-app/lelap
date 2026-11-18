package app.lelap.library

import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CoverFileTest {
  private val dir = Files.createTempDirectory("covers").toFile()

  @Test
  fun keepsAFinishedCoverUnderItsName() {
    val target = dir.resolve("folder-1.jpg")
    CoverFile.writeAtomically(target) { it.write(byteArrayOf(1, 2, 3)) }
    assertArrayEquals(byteArrayOf(1, 2, 3), target.readBytes())
    assertEquals(listOf("folder-1.jpg"), dir.list()!!.toList())
  }

  @Test
  fun leavesNothingWhenTheWriteStops() {
    val target = dir.resolve("folder-2.jpg")
    try {
      CoverFile.writeAtomically(target) {
        it.write(byteArrayOf(1))
        throw IOException("cut short")
      }
    } catch (e: IOException) {
      // Expected.
    }
    assertFalse(target.exists())
    assertEquals(emptyList<String>(), dir.list()!!.toList())
  }
}
