package app.lelap.library

import org.junit.Assert.assertEquals
import org.junit.Test

class TreeWalkTest {
  private val tree = mapOf(
    "primary:Books" to listOf(
      TreeEntry("primary:Books/Novel", "Novel", isDirectory = true, size = 0, modifiedAt = 0),
      TreeEntry("primary:Books/loose.mp3", "loose.mp3", isDirectory = false, size = 5, modifiedAt = 7),
    ),
    "primary:Books/Novel" to listOf(
      TreeEntry("primary:Books/Novel/CD 1", "CD 1", isDirectory = true, size = 0, modifiedAt = 0),
      TreeEntry("primary:Books/Novel/.nomedia", ".nomedia", isDirectory = false, size = 0, modifiedAt = 1),
    ),
    "primary:Books/Novel/CD 1" to listOf(
      TreeEntry("primary:Books/Novel/CD 1/01.mp3", "01.mp3", isDirectory = false, size = 9, modifiedAt = 3),
    ),
  )

  @Test
  fun listsEveryFileWithItsPathBelowTheRoot() {
    val files = TreeWalk.walk("primary:Books") { tree[it].orEmpty() }
    assertEquals(
      listOf("Novel/.nomedia", "Novel/CD 1/01.mp3", "loose.mp3"),
      files.map { it.relPath }.sorted(),
    )
    val deep = files.single { it.name == "01.mp3" }
    assertEquals("primary:Books/Novel/CD 1/01.mp3", deep.location)
    assertEquals(9L, deep.size)
    assertEquals(3L, deep.modifiedAt)
  }

  @Test
  fun listsAnEmptyFolderAsNothing() {
    assertEquals(emptyList<ListedEntry>(), TreeWalk.walk("primary:Empty") { emptyList() })
  }
}
