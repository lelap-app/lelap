package app.lelap.library

/** A child of a folder, as the documents provider reports it. */
data class TreeEntry(
  val documentId: String,
  val name: String,
  val isDirectory: Boolean,
  val size: Long,
  val modifiedAt: Long,
)

/** A file below the library folder. [location] is its document ID, a volume path. */
data class ListedEntry(
  val location: String,
  val relPath: String,
  val name: String,
  val size: Long,
  val modifiedAt: Long,
)

object TreeWalk {
  /**
   * Every file below [rootId], breadth first, with its path relative to the root. Each folder is
   * read once: a provider that lists a folder inside itself (a link, a cloud alias) would otherwise
   * keep the walk going for ever.
   */
  fun walk(rootId: String, children: (String) -> List<TreeEntry>): List<ListedEntry> {
    val files = mutableListOf<ListedEntry>()
    val pending = ArrayDeque(listOf(rootId to ""))
    val visited = hashSetOf(rootId)
    while (pending.isNotEmpty()) {
      val (folderId, prefix) = pending.removeFirst()
      for (entry in children(folderId)) {
        val relPath = if (prefix.isEmpty()) entry.name else "$prefix/${entry.name}"
        if (entry.isDirectory) {
          if (visited.add(entry.documentId)) pending.addLast(entry.documentId to relPath)
        } else {
          files += ListedEntry(entry.documentId, relPath, entry.name, entry.size, entry.modifiedAt)
        }
      }
    }
    return files
  }
}
