package app.lelap.download

import app.lelap.netfs.NetFailure
import app.lelap.netfs.Netfs
import java.io.IOException
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

private const val BUFFER_BYTES = 64 * 1024

/**
 * Downloads one file from an SMB or SFTP server (M62), continuing a `.part` file left by an
 * earlier run: these servers read at any offset, so a resume needs no Range header.
 */
object NetDownload {
  /** [describe] words a failure that will not pass, such as a refused login. */
  suspend fun fetch(
    url: String,
    folder: BookFolder,
    name: String,
    headers: Map<String, String>,
    describe: (NetFailure) -> String,
    onBytes: suspend (Long) -> Unit,
  ) {
    val part = name + PART_SUFFIX
    try {
      Netfs.open(url, headers).use { opened ->
        val length = opened.file.length
        val existing = folder.length(part) ?: 0L
        // A part file longer than the file is from an older version of it.
        val start = if (existing in 0..length) existing else 0L
        if (start < length) {
          folder.output(part, append = start > 0).use { out ->
            val buffer = ByteArray(BUFFER_BYTES)
            var position = start
            while (position < length) {
              coroutineContext.ensureActive()
              val n = opened.file.read(position, buffer, 0, minOf(BUFFER_BYTES.toLong(), length - position).toInt())
              if (n < 0) throw IOException("The file ended early.")
              out.write(buffer, 0, n)
              position += n
              onBytes(position)
            }
          }
        } else if (folder.length(part) == null) {
          // An empty file: nothing to copy, but it is still a file.
          folder.output(part, append = false).close()
        }
      }
    } catch (e: NetFailure) {
      if (e.kind.permanent) throw PermanentFailure(describe(e))
      throw e
    }
    folder.rename(part, name)
  }
}
