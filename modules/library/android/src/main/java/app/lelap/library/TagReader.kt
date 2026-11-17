package app.lelap.library

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.security.MessageDigest

private const val COVER_MAX_PX = 600

data class Tags(
  val durationMs: Long,
  val title: String?,
  val album: String?,
  val artist: String?,
  val albumArtist: String?,
  val coverPath: String?,
  val chapters: List<Chapter>,
)

/** Text tags, duration and embedded cover from Android, chapters from our own parsers. */
class TagReader(private val context: Context) {
  /** A file on a WebDAV server or behind a pre-signed S3 link; chapters through Range requests. */
  fun readRemote(url: String, headers: Map<String, String>, name: String, coverDir: File): Tags {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(url, headers)
      fun tag(key: Int) = retriever.extractMetadata(key)?.trim()?.takeIf { it.isNotEmpty() }
      // Pre-signed links change on every scan; the cover is named after the path without them.
      val coverKey = Uri.parse(url.substringBefore('?'))
      val cover = retriever.embeddedPicture?.let { saveCover(it, coverKey, coverDir) }
      val bytes = RemoteBytes(url, headers)
      val chapters = runCatching { parseChapters(name, bytes::read, bytes.size) }.getOrDefault(emptyList())
      return Tags(
        durationMs = tag(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L,
        title = tag(MediaMetadataRetriever.METADATA_KEY_TITLE),
        album = tag(MediaMetadataRetriever.METADATA_KEY_ALBUM),
        artist = tag(MediaMetadataRetriever.METADATA_KEY_ARTIST),
        albumArtist = tag(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST),
        coverPath = cover,
        chapters = chapters,
      )
    } finally {
      retriever.release()
    }
  }

  fun read(uri: Uri, name: String, coverDir: File): Tags {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      fun tag(key: Int) = retriever.extractMetadata(key)?.trim()?.takeIf { it.isNotEmpty() }
      val cover = retriever.embeddedPicture?.let { saveCover(it, uri, coverDir) }
      return Tags(
        durationMs = tag(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L,
        title = tag(MediaMetadataRetriever.METADATA_KEY_TITLE),
        album = tag(MediaMetadataRetriever.METADATA_KEY_ALBUM),
        artist = tag(MediaMetadataRetriever.METADATA_KEY_ARTIST),
        albumArtist = tag(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST),
        coverPath = cover,
        chapters = chapters(uri, name),
      )
    } finally {
      retriever.release()
    }
  }

  /** Saves a `cover.jpg`-style image as a small cover file. */
  fun readImage(uri: Uri, coverDir: File): String? {
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    return saveCover(bytes, uri, coverDir)
  }

  private fun chapters(uri: Uri, name: String): List<Chapter> {
    val descriptor = context.contentResolver.openFileDescriptor(uri, "r") ?: return emptyList()
    descriptor.use { pfd ->
      FileInputStream(pfd.fileDescriptor).channel.use { channel ->
        val size = channel.size()
        val read = { offset: Long, length: Int ->
          // Parsers ask for small reads; refuse anything that would cost real memory.
          require(length in 0..(8 shl 20))
          val buffer = ByteBuffer.allocate(length)
          while (buffer.hasRemaining() && channel.read(buffer, offset + buffer.position()) > 0) Unit
          buffer.array().copyOf(buffer.position())
        }
        return parseChapters(name, read, size)
      }
    }
  }

  private fun parseChapters(name: String, read: (Long, Int) -> ByteArray, size: Long): List<Chapter> =
    when (name.substringAfterLast('.', "").lowercase()) {
      "mp3" -> Id3Chapters.parse(read, size)
      "m4a", "m4b", "mp4", "aac" -> Mp4Chapters.parse(read, size)
      else -> emptyList()
    }

  private fun saveCover(bytes: ByteArray, uri: Uri, coverDir: File): String? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= COVER_MAX_PX) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: return null
    val scale = COVER_MAX_PX.toFloat() / maxOf(decoded.width, decoded.height)
    val bitmap = if (scale < 1f) {
      Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true)
    } else {
      decoded
    }
    coverDir.mkdirs()
    val file = File(coverDir, "${sha1(uri.toString())}.jpg")
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
    return file.absolutePath
  }

  private fun sha1(text: String) =
    MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
}
