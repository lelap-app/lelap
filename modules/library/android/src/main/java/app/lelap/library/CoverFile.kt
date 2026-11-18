package app.lelap.library

import java.io.File
import java.io.IOException
import java.io.OutputStream

object CoverFile {
  /**
   * Writes [target] under a `.part` name first and renames it when complete. The app keeps a cover
   * once its file exists, so a write cut short must never leave one under the final name.
   */
  fun writeAtomically(target: File, write: (OutputStream) -> Unit) {
    val part = File(target.parentFile, "${target.name}.part")
    try {
      part.outputStream().use(write)
      if (!part.renameTo(target)) throw IOException("Could not save ${target.name}.")
    } finally {
      part.delete()
    }
  }
}
