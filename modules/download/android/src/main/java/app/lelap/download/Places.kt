package app.lelap.download

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.os.storage.StorageManager
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/** Where downloaded books live: the app's private storage, or a folder the listener chose. */
interface Place {
  /** The chosen folder's tree URI; null for private storage. */
  val uri: String?

  /** False when the folder is gone: an SD card taken out, or the permission withdrawn. */
  fun available(): Boolean

  /** The book's folder; null when it doesn't exist and [create] is false. */
  fun folder(bookId: String, create: Boolean): BookFolder?

  /** Every book folder there, by book ID, listed at once. */
  fun folders(): Map<String, BookFolder>

  /** Deletes the book's files there. */
  fun removeFolder(bookId: String)

  /** The free and total bytes of the storage it is on, or null when unknown. */
  fun space(): Pair<Long, Long>?
}

/** Files Lelap keeps next to a privately stored book that are not the book itself. */
val BOOKKEEPING = setOf("job.json", "job.json.tmp", "error.txt", "old.json", "old.json.tmp")

/** The app's private storage: each book's files sit next to its `job.json`. */
class PrivatePlace(private val root: File) : Place {
  override val uri: String? = null

  override fun available() = true

  override fun folder(bookId: String, create: Boolean): BookFolder? {
    val dir = File(root, bookId)
    if (!create && !dir.isDirectory) return null
    return FileFolder(dir, BOOKKEEPING)
  }

  override fun folders(): Map<String, BookFolder> =
    root.listFiles { f -> f.isDirectory }.orEmpty().associate { it.name to FileFolder(it, BOOKKEEPING) }

  override fun removeFolder(bookId: String) {
    val folder = folder(bookId, create = false) ?: return
    folder.list().keys.forEach(folder::delete)
  }

  override fun space(): Pair<Long, Long> = StatFs(root.parentFile?.path ?: root.path).let { it.availableBytes to it.totalBytes }
}

/**
 * A folder the listener picked with Android's folder picker. Books go into `Lelap/<book>/` inside
 * it, through the Storage Access Framework, which reaches SD cards and shared storage alike.
 */
class TreePlace(private val context: Context, private val tree: Uri) : Place {
  override val uri: String = tree.toString()
  private val resolver = context.contentResolver
  private val rootId: String = DocumentsContract.getTreeDocumentId(tree)

  private data class Child(val id: String, val name: String, val size: Long, val isDir: Boolean)

  private fun documentUri(id: String) = DocumentsContract.buildDocumentUriUsingTree(tree, id)

  private fun children(parentId: String): List<Child> {
    val columns = arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_SIZE, Document.COLUMN_MIME_TYPE)
    // A null cursor means the storage is gone; never read that as an empty folder.
    val cursor = resolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId), columns, null, null, null)
      ?: throw IOException("The download folder can't be reached.")
    return cursor.use {
      buildList {
        while (it.moveToNext()) {
          add(
            Child(
              id = it.getString(0),
              name = it.getString(1) ?: "",
              size = if (it.isNull(2)) 0L else it.getLong(2),
              isDir = it.getString(3) == Document.MIME_TYPE_DIR,
            ),
          )
        }
      }
    }
  }

  private fun child(parentId: String, name: String) = children(parentId).find { it.name == name }

  private fun createDocument(parentId: String, mime: String, name: String): String {
    // Octet-stream, so the provider never adds an extension of its own to `001.mp3.part`.
    val created = DocumentsContract.createDocument(resolver, documentUri(parentId), mime, name)
      ?: throw IOException("Could not create $name in the download folder.")
    return DocumentsContract.getDocumentId(created)
  }

  private fun directory(parentId: String, name: String, create: Boolean): String? {
    child(parentId, name)?.let { return if (it.isDir) it.id else throw IOException("$name is not a folder.") }
    return if (create) createDocument(parentId, Document.MIME_TYPE_DIR, name) else null
  }

  /** `Lelap/` in the chosen folder, with markers that keep media apps and Lelap's own library scan out. */
  private fun base(create: Boolean): String? {
    child(rootId, LocationRules.FOLDER_NAME)?.let { return it.id }
    if (!create) return null
    val id = createDocument(rootId, Document.MIME_TYPE_DIR, LocationRules.FOLDER_NAME)
    for (marker in LocationRules.MARKERS) runCatching { createDocument(id, OCTET, marker) }
    return id
  }

  override fun available(): Boolean {
    val granted = resolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission && it.isWritePermission }
    if (!granted) return false
    return runCatching {
      resolver.query(documentUri(rootId), arrayOf(Document.COLUMN_DOCUMENT_ID), null, null, null)?.use { it.moveToFirst() } ?: false
    }.getOrDefault(false)
  }

  override fun folder(bookId: String, create: Boolean): BookFolder? {
    // Downloads and the move run side by side; two of them creating `Lelap/` at once would get
    // `Lelap (1)` from the provider, and books in it would never be found.
    if (create) return synchronized(TreePlace::class.java) { folderOrNull(bookId, true) }
    return folderOrNull(bookId, false)
  }

  private fun folderOrNull(bookId: String, create: Boolean): BookFolder? {
    val base = base(create) ?: return null
    return directory(base, bookId, create)?.let(::TreeFolder)
  }

  override fun folders(): Map<String, BookFolder> {
    val base = base(create = false) ?: return emptyMap()
    return children(base).filter { it.isDir }.associate { it.name to TreeFolder(it.id) }
  }

  override fun removeFolder(bookId: String) {
    val base = base(create = false) ?: return
    // Deleting a folder document takes its files with it.
    child(base, bookId)?.let { DocumentsContract.deleteDocument(resolver, documentUri(it.id)) }
  }

  override fun space(): Pair<Long, Long>? = volumeDirectory()?.let { StatFs(it.path) }?.let { it.availableBytes to it.totalBytes }

  private fun volumeDirectory(): File? {
    val volume = LocationRules.volumeOf(rootId) ?: return null
    if (volume == LocationRules.PRIMARY) return Environment.getExternalStorageDirectory()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val manager = context.getSystemService(StorageManager::class.java)
      return manager?.storageVolumes?.find { it.uuid.equals(volume, ignoreCase = true) }?.directory
    }
    // Before Android 11 a volume's root is not handed out; the app's own folder on it is.
    return context.getExternalFilesDirs(null).filterNotNull().find { it.path.contains("/$volume/", ignoreCase = true) }
  }

  private inner class TreeFolder(private val id: String) : BookFolder {
    override fun list(): Map<String, Long> = children(id).filter { !it.isDir }.associate { it.name to it.size }

    override fun output(name: String, append: Boolean): OutputStream {
      val doc = child(id, name)?.id ?: createDocument(id, OCTET, name)
      // "wt" truncates for certain; plain "w" leaves old bytes behind on some Android versions.
      return resolver.openOutputStream(documentUri(doc), if (append) "wa" else "wt")
        ?: throw IOException("Could not write $name.")
    }

    override fun input(name: String): InputStream {
      val doc = child(id, name) ?: throw IOException("$name is missing.")
      return resolver.openInputStream(documentUri(doc.id)) ?: throw IOException("Could not read $name.")
    }

    override fun rename(from: String, to: String) {
      // Providers add “ (1)” rather than replace, so the old file goes first.
      child(id, to)?.let { DocumentsContract.deleteDocument(resolver, documentUri(it.id)) }
      val doc = child(id, from) ?: throw IOException("$from is missing.")
      DocumentsContract.renameDocument(resolver, documentUri(doc.id), to)
        ?: throw IOException("Could not save $to.")
      if (child(id, to) == null) throw IOException("Could not save $to.")
    }

    override fun delete(name: String) {
      child(id, name)?.let { DocumentsContract.deleteDocument(resolver, documentUri(it.id)) }
    }

    override fun path(name: String): String =
      documentUri(child(id, name)?.id ?: throw IOException("$name is missing.")).toString()

    // One listing for every name, rather than one per file.
    override fun paths(names: Collection<String>): Map<String, String> {
      val byName = children(id).associateBy { it.name }
      return names.mapNotNull { n -> byName[n]?.let { n to documentUri(it.id).toString() } }.toMap()
    }
  }

  private companion object {
    const val OCTET = "application/octet-stream"
  }
}

/** The pure rules about chosen folders, tested on the JVM. */
object LocationRules {
  const val PRIMARY = "primary"
  const val FOLDER_NAME = "Lelap"
  /** `.nomedia` keeps music apps from listing chapters as songs; the other keeps Lelap's own library scan out. */
  val MARKERS = listOf(".nomedia", ".lelap-downloads")

  /** The storage volume of a tree's document ID: `primary` or an SD card's ID such as `1A2B-3C4D`. */
  fun volumeOf(documentId: String): String? = documentId.substringBefore(':', "").ifEmpty { null }

  /** The folder's path on its volume, `Audiobooks/Lelap`, empty for the volume's top. */
  fun pathOf(documentId: String): String = documentId.substringAfter(':', "")

  /**
   * Whether a book should move now. One still downloading is left alone: it moves once it is done,
   * so the move never races the worker writing its files.
   */
  fun shouldMove(bookLocation: String?, target: String?, work: WorkState): Boolean =
    bookLocation != target && work != WorkState.RUNNING && work != WorkState.ENQUEUED && work != WorkState.BLOCKED
}
