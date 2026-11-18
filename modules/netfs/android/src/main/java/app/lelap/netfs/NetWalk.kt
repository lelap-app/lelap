package app.lelap.netfs

/** A file below the walked folder: [path] is relative to it, `/`-separated. */
data class WalkedFile(val path: String, val size: Long, val modifiedAt: Long)

/**
 * Every file below a folder, one folder at a time, bounded like `listWebdav`: at most
 * [maxFolders] folders and [maxDepth] levels, so a link loop or a huge share ends instead of
 * running on. Each request has the session's own time limit (30 s).
 */
object NetWalk {
  const val MAX_FOLDERS = 5_000
  const val MAX_DEPTH = 32

  // Folders a NAS keeps for itself: thumbnails, the recycle bin, snapshots.
  private val SKIPPED = setOf("@eadir", "#recycle", "#snapshot", "\$recycle.bin", "system volume information")

  fun skipped(name: String) = name.startsWith(".") || name.lowercase() in SKIPPED

  fun list(session: NetSession, root: String, maxFolders: Int = MAX_FOLDERS, maxDepth: Int = MAX_DEPTH): List<WalkedFile> {
    val files = ArrayList<WalkedFile>()
    val queue = ArrayDeque<Pair<String, String>>() // server path, relative path
    queue.add(root to "")
    val seen = HashSet<String>()
    while (queue.isNotEmpty()) {
      val (path, rel) = queue.removeFirst()
      if (!seen.add(path)) continue
      if (seen.size > maxFolders) break
      for (listed in session.list(path)) {
        if (listed.name == "." || listed.name == ".." || skipped(listed.name)) continue
        val childPath = NetAddress.child(path, listed.name)
        val childRel = if (rel.isEmpty()) listed.name else "$rel/${listed.name}"
        // A link is followed once; a broken one is left out.
        val entry = if (listed.link) runCatching { session.stat(childPath).copy(name = listed.name) }.getOrNull() ?: continue else listed
        if (entry.folder) {
          if (childRel.count { it == '/' } + 1 < maxDepth) queue.add(childPath to childRel)
        } else {
          files.add(WalkedFile(childRel, entry.size, entry.modifiedAt))
        }
      }
    }
    return files
  }
}
