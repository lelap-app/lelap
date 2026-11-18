package app.lelap.netfs

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSourceException
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener

/**
 * Media3 reads an SMB or SFTP file through this: [open] at any position, so seeking works without
 * reading from the start. The login comes as the request's headers, like a WebDAV one.
 */
@OptIn(UnstableApi::class)
class NetDataSource : BaseDataSource(/* isNetwork= */ true) {
  private var opened: Netfs.Opened? = null
  private var ahead: ReadAhead? = null
  private var uri: Uri? = null
  private var position = 0L
  private var remaining = 0L
  private var started = false

  override fun open(dataSpec: DataSpec): Long {
    uri = dataSpec.uri
    transferInitializing(dataSpec)
    val file = Netfs.open(dataSpec.uri.toString(), dataSpec.httpRequestHeaders).also { opened = it }.file
    ahead = ReadAhead(file)
    if (dataSpec.position > file.length) {
      throw DataSourceException(PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE)
    }
    position = dataSpec.position
    val left = file.length - position
    remaining = if (dataSpec.length == C.LENGTH_UNSET.toLong()) left else minOf(dataSpec.length, left)
    started = true
    transferStarted(dataSpec)
    return remaining
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    if (length == 0) return 0
    if (remaining == 0L) return C.RESULT_END_OF_INPUT
    val reader = ahead ?: return C.RESULT_END_OF_INPUT
    val n = try {
      reader.read(position, buffer, offset, minOf(length.toLong(), remaining).toInt())
    } catch (e: NetFailure) {
      if (breaksConnection(e)) opened?.broken()
      throw e
    }
    if (n < 0) return C.RESULT_END_OF_INPUT
    position += n
    remaining -= n
    bytesTransferred(n)
    return n
  }

  override fun getUri(): Uri? = uri

  override fun close() {
    uri = null
    try {
      opened?.close()
    } finally {
      opened = null
      ahead = null
      if (started) {
        started = false
        transferEnded()
      }
    }
  }

  /**
   * Hands `smb://` and `sftp://` addresses to [NetDataSource] and everything else to [fallback]
   * (files, content URIs, HTTP), chosen per request.
   */
  class Factory(private val fallback: DataSource.Factory) : DataSource.Factory {
    override fun createDataSource(): DataSource = Routing(fallback.createDataSource())
  }

  private class Routing(private val fallback: DataSource) : DataSource {
    private val net = NetDataSource()
    private var current: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
      fallback.addTransferListener(transferListener)
      net.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
      val source = if (Netfs.handles(dataSpec.uri.toString())) net else fallback
      current = source
      return source.open(dataSpec)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
      current?.read(buffer, offset, length) ?: C.RESULT_END_OF_INPUT

    override fun getUri(): Uri? = current?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = current?.responseHeaders ?: emptyMap()

    override fun close() {
      try {
        current?.close()
      } finally {
        current = null
      }
    }
  }
}
