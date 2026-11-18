package app.lelap.download

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import org.json.JSONArray
import org.json.JSONObject

/**
 * One book's files in one place: the app's private storage or a folder the listener chose. Names
 * are plain file names, already checked by [DownloadJob.isSafeName].
 */
interface BookFolder {
  /** Every file by name, with its length. */
  fun list(): Map<String, Long>

  fun length(name: String): Long? = list()[name]

  fun output(name: String, append: Boolean): OutputStream

  fun input(name: String): InputStream

  /** Renames [from] to [to], replacing a file already called [to]. */
  fun rename(from: String, to: String)

  fun delete(name: String)

  /** Where the player reads the file: an absolute path, or a content URI. */
  fun path(name: String): String

  /** [path] of each of [names] that exists. */
  fun paths(names: Collection<String>): Map<String, String> =
    names.filter { length(it) != null }.associateWith(::path)
}

/** A book's folder on a plain file system. [keep] names bookkeeping files that are not the book's. */
class FileFolder(val dir: File, private val keep: Set<String> = emptySet()) : BookFolder {
  override fun list(): Map<String, Long> =
    dir.listFiles { f -> f.isFile && f.name !in keep }.orEmpty().associate { it.name to it.length() }

  override fun length(name: String): Long? = File(dir, name).takeIf { it.isFile }?.length()

  override fun output(name: String, append: Boolean): OutputStream {
    dir.mkdirs()
    return FileOutputStream(File(dir, name), append)
  }

  override fun input(name: String): InputStream = FileInputStream(File(dir, name))

  override fun rename(from: String, to: String) {
    if (!File(dir, from).renameTo(File(dir, to))) throw IOException("Could not save $to.")
  }

  override fun delete(name: String) {
    File(dir, name).delete()
  }

  override fun path(name: String): String = File(dir, name).absolutePath
}

/** Moving one book's files from one place to another without ever losing one. */
object BookMove {
  /** A copy on its way; only a complete, checked copy gets the file's own name. */
  const val COPY_SUFFIX = ".move"
  private const val BUFFER_BYTES = 64 * 1024

  /** Deletes the half copies a stopped move left in [folder]; true when nothing else is in it. */
  fun clearLeftovers(folder: BookFolder): Boolean {
    folder.list().keys.filter { it.endsWith(COPY_SUFFIX) }.forEach(folder::delete)
    return folder.list().isEmpty()
  }

  /**
   * Copies every file of [from] into [to], each under a temporary name first and checked by its
   * length before it gets its own name. Never deletes an original: that waits until the book
   * points at [to] and the player has let go of the old files (see [OldCopies]). Run again after a
   * stop, it skips the copies that are already complete. Returns the names now in both places.
   */
  fun copy(
    from: BookFolder,
    to: BookFolder,
    checkStopped: () -> Unit = {},
    onBytes: (Long) -> Unit = {},
  ): List<String> {
    val files = from.list().filterKeys { !it.endsWith(COPY_SUFFIX) }
    val there = to.list()
    var copied = 0L
    for ((name, size) in files) {
      if (there[name] == size) {
        copied += size
        onBytes(copied)
        continue
      }
      val temporary = name + COPY_SUFFIX
      from.input(name).use { input ->
        to.output(temporary, append = false).use { output ->
          val buffer = ByteArray(BUFFER_BYTES)
          while (true) {
            checkStopped()
            val n = input.read(buffer)
            if (n < 0) break
            output.write(buffer, 0, n)
            copied += n
            onBytes(copied)
          }
        }
      }
      if (to.length(temporary) != size) {
        to.delete(temporary)
        throw IOException("The copy of $name came out the wrong size.")
      }
      to.rename(temporary, name)
    }
    return files.keys.toList()
  }
}

/**
 * Copies a move left behind, kept in the book's private `old.json` until the app has switched the
 * player to the new files. Written before the book points at its new folder, so a crash in
 * between never leaves copies nobody knows about.
 */
data class OldCopy(val location: String?, val names: List<String>)

object OldCopies {
  fun encode(copies: List<OldCopy>): String = JSONArray().apply {
    copies.forEach { c ->
      put(JSONObject().put("location", c.location ?: JSONObject.NULL).put("names", JSONArray(c.names)))
    }
  }.toString()

  fun decode(json: String?): List<OldCopy> = try {
    val array = JSONArray(json ?: "[]")
    (0 until array.length()).map { i ->
      val o = array.getJSONObject(i)
      val names = o.getJSONArray("names")
      OldCopy(
        location = if (o.isNull("location")) null else o.getString("location"),
        names = (0 until names.length()).map(names::getString).filter(DownloadJob::isSafeName),
      )
    }
  } catch (e: org.json.JSONException) {
    emptyList()
  }

  /**
   * Which of [copies] may be deleted now that the book's files are in [current]. A copy in the
   * place the book lives in again (moved there and back) is the live one and is only forgotten.
   */
  fun deletable(copies: List<OldCopy>, current: String?): List<OldCopy> = copies.filter { it.location != current }
}
