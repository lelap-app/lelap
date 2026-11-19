package app.lelap.audio

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import java.io.IOException

/**
 * Reads a file with a login over HTTP through [LoginHttp], so each request follows its redirects
 * afresh and the login reaches only the file's own server (M100). Errors are Media3's own, so the
 * player's expired-link retry and its diagnostics see the status as before.
 */
@OptIn(UnstableApi::class)
class LoginDataSource(private val login: Map<String, String>) : BaseDataSource(true) {
  private var answer: LoginHttp.Answer? = null
  private var spec: DataSpec? = null
  private var left = C.LENGTH_UNSET.toLong()
  private var opened = false

  override fun open(dataSpec: DataSpec): Long {
    spec = dataSpec
    transferInitializing(dataSpec)
    val reply = try {
      LoginHttp.open(dataSpec.uri.toString(), login, dataSpec.httpRequestHeaders, dataSpec.position, dataSpec.length)
    } catch (e: IOException) {
      throw HttpDataSource.HttpDataSourceException.createForIOException(e, dataSpec, HttpDataSource.HttpDataSourceException.TYPE_OPEN)
    }
    answer = reply
    if (reply.status !in 200..299) {
      val range = reply.connection.getHeaderField("Content-Range")
      // Asked from the very end of the file: nothing more to read, as Media3's own source does.
      if (reply.status == 416 && dataSpec.position == LoginHttp.documentSize(range)) {
        opened = true
        transferStarted(dataSpec)
        left = 0L
        return if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else 0L
      }
      val headers = headerFields(reply)
      val message = runCatching { reply.connection.responseMessage }.getOrNull()
      reply.connection.disconnect()
      answer = null
      val cause = if (reply.status == 416) DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE) else null
      throw HttpDataSource.InvalidResponseCodeException(
        reply.status,
        message,
        cause,
        headers,
        dataSpec,
        ByteArray(0),
      )
    }
    opened = true
    left = reply.length
    transferStarted(dataSpec)
    return reply.length
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    if (length == 0) return 0
    if (left == 0L) return C.RESULT_END_OF_INPUT
    val stream = answer?.stream ?: return C.RESULT_END_OF_INPUT
    val wanted = if (left < 0L) length else minOf(length.toLong(), left).toInt()
    val read = try {
      stream.read(buffer, offset, wanted)
    } catch (e: IOException) {
      throw HttpDataSource.HttpDataSourceException.createForIOException(
        e,
        spec ?: DataSpec(Uri.EMPTY),
        HttpDataSource.HttpDataSourceException.TYPE_READ,
      )
    }
    if (read < 0) return C.RESULT_END_OF_INPUT
    if (left > 0L) left -= read
    bytesTransferred(read)
    return read
  }

  override fun getUri(): Uri? = answer?.let { Uri.parse(it.url) } ?: spec?.uri

  override fun getResponseHeaders(): Map<String, List<String>> = answer?.let(::headerFields).orEmpty()

  override fun close() {
    try {
      answer?.stream?.close()
    } catch (_: IOException) {
      // Closing a stream that broke off; nothing to keep.
    } finally {
      answer?.connection?.disconnect()
      answer = null
      if (opened) {
        opened = false
        transferEnded()
      }
    }
  }

  private fun headerFields(reply: LoginHttp.Answer): Map<String, List<String>> =
    reply.connection.headerFields.filterKeys { it != null }.mapKeys { it.key!! }
}

/**
 * The player's source for a book's files: a file whose book has a login over HTTP goes through
 * [LoginDataSource]; SMB and SFTP ([handledNatively]) get the login as headers for their own
 * source; everything else goes to [upstream] as it is.
 */
@OptIn(UnstableApi::class)
class BookFileDataSource(
  private val upstream: DataSource,
  private val loginFor: (String) -> Map<String, String>?,
  private val handledNatively: (String) -> Boolean,
) : DataSource {
  private val listeners = mutableListOf<TransferListener>()
  private var active: DataSource? = null

  override fun addTransferListener(transferListener: TransferListener) {
    listeners.add(transferListener)
    upstream.addTransferListener(transferListener)
  }

  override fun open(dataSpec: DataSpec): Long {
    val uri = dataSpec.uri.toString()
    val login = loginFor(uri)
    val scheme = dataSpec.uri.scheme?.lowercase()
    val source = when {
      login == null -> upstream
      handledNatively(uri) -> return upstream.also { active = it }.open(dataSpec.withAdditionalHeaders(login))
      scheme == "http" || scheme == "https" -> LoginDataSource(login).also { s -> listeners.forEach(s::addTransferListener) }
      else -> upstream
    }
    active = source
    return source.open(dataSpec)
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
    active?.read(buffer, offset, length) ?: C.RESULT_END_OF_INPUT

  override fun getUri(): Uri? = active?.uri

  override fun getResponseHeaders(): Map<String, List<String>> = active?.responseHeaders.orEmpty()

  override fun close() {
    val source = active
    active = null
    source?.close()
  }
}
