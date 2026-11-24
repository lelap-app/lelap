package app.lelap.library

/** One persisted folder grant, as `ContentResolver.persistedUriPermissions` lists it. */
data class FolderGrant(val uri: String, val read: Boolean, val write: Boolean)

object FolderGrants {
  /**
   * The grants to give back once the library folder changed: read-only ones (the library's kind)
   * not in [keep]. A grant with write access is the download folder's (`modules/download`) and
   * stays, as does any folder still in use.
   */
  fun toRelease(grants: List<FolderGrant>, keep: Set<String>): List<String> =
    grants.filter { it.read && !it.write && it.uri !in keep }.map { it.uri }
}
