package app.lelap.library

import org.junit.Assert.assertEquals
import org.junit.Test

class FolderGrantsTest {
  private val library = "content://com.android.externalstorage.documents/tree/primary%3ABooks"
  private val earlier = "content://com.android.externalstorage.documents/tree/primary%3AEarlier"
  private val downloads = "content://com.android.externalstorage.documents/tree/primary%3AAudiobooks"

  @Test
  fun givesBackOnlyEarlierLibraryFolders() {
    val grants = listOf(
      FolderGrant(library, read = true, write = false),
      FolderGrant(earlier, read = true, write = false),
      FolderGrant(downloads, read = true, write = true),
    )
    assertEquals(listOf(earlier), FolderGrants.toRelease(grants, keep = setOf(library)))
  }

  @Test
  fun keepsEverythingStillInUse() {
    val grants = listOf(FolderGrant(library, read = true, write = false))
    assertEquals(emptyList<String>(), FolderGrants.toRelease(grants, keep = setOf(library)))
  }
}
