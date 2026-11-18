package app.lelap.library

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaDataSource
import android.media.MediaMetadataRetriever
import android.net.Uri
import app.lelap.netfs.NetBytes
import app.lelap.netfs.Netfs
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
  /** ISBN and ASIN tags by name, unchecked (`IdTags`). */
  val idTags: Map<String, String>,
  /** Genre, ISRC and the like, for telling songs from books (M77). */
  val kind: KindTags,
)

data class KindTags(
  val genre: String?,
  val isrc: String?,
  val track: String?,
  val year: String?,
  /** A narrator tag, else the composer, which audiobooks often use for the narrator. */
  val narrator: String?,
  val mediaKind: String?,
) {
  fun toMap(): Map<String, String?> = mapOf(
    "genre" to genre,
    "isrc" to isrc,
    "track" to track,
    "year" to year,
    "narrator" to narrator,
    "mediaKind" to mediaKind,
  )
}

private fun kindTags(tag: (Int) -> String?, file: FileTags) = KindTags(
  genre = tag(MediaMetadataRetriever.METADATA_KEY_GENRE) ?: file.genre,
  isrc = file.isrc,
  track = tag(MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER),
  year = tag(MediaMetadataRetriever.METADATA_KEY_YEAR),
  narrator = file.narrator ?: tag(MediaMetadataRetriever.METADATA_KEY_COMPOSER),
  mediaKind = file.mediaKind,
)

/** Text tags, duration and embedded cover from Android, chapters from our own parsers. */
class TagReader(private val context: Context) {
  /** A file on a WebDAV server or behind a pre-signed S3 link; chapters through Range requests. */
  fun readRemote(url: String, headers: Map<String, String>, name: String, coverDir: File): Tags {
    if (Netfs.handles(url)) return readNet(url, headers, name, coverDir)
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(url, headers)
      fun tag(key: Int) = retriever.extractMetadata(key)?.trim()?.takeIf { it.isNotEmpty() }
      // Pre-signed links change on every scan; the cover is named after the path without them.
      val coverKey = Uri.parse(url.substringBefore('?'))
      val cover = embeddedCover(retriever, coverKey, coverDir)
      val bytes = RemoteBytes(url, headers)
      val chapters = runCatching { parseChapters(name, bytes::read, bytes.size) }.getOrDefault(emptyList())
      val fileTags = runCatching { IdTags.parseAll(name, bytes::read, bytes.size) }.getOrDefault(FileTags())
      return Tags(
        durationMs = tag(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L,
        title = tag(MediaMetadataRetriever.METADATA_KEY_TITLE),
        album = tag(MediaMetadataRetriever.METADATA_KEY_ALBUM),
        artist = tag(MediaMetadataRetriever.METADATA_KEY_ARTIST),
        albumArtist = tag(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST),
        coverPath = cover,
        chapters = chapters,
        idTags = fileTags.ids,
        kind = kindTags(::tag, fileTags),
      )
    } finally {
      retriever.release()
    }
  }

  /**
   * A file on an SMB or SFTP server (M62): Android's reader and our parsers share one connection
   * and one block cache, read at the offsets they ask for.
   */
  private fun readNet(url: String, headers: Map<String, String>, name: String, coverDir: File): Tags =
    Netfs.open(url, headers).use { opened ->
      val bytes = NetBytes(opened.file)
      val retriever = MediaMetadataRetriever()
      try {
        retriever.setDataSource(object : MediaDataSource() {
          override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
            if (position >= bytes.size) return -1
            val read = bytes.read(position, size)
            System.arraycopy(read, 0, buffer, offset, read.size)
            return read.size
          }

          override fun getSize(): Long = bytes.size

          override fun close() = Unit
        })
        fun tag(key: Int) = retriever.extractMetadata(key)?.trim()?.takeIf { it.isNotEmpty() }
        val cover = embeddedCover(retriever, Uri.parse(url), coverDir)
        val fileTags = runCatching { IdTags.parseAll(name, bytes::read, bytes.size) }.getOrDefault(FileTags())
        Tags(
          durationMs = tag(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L,
          title = tag(MediaMetadataRetriever.METADATA_KEY_TITLE),
          album = tag(MediaMetadataRetriever.METADATA_KEY_ALBUM),
          artist = tag(MediaMetadataRetriever.METADATA_KEY_ARTIST),
          albumArtist = tag(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST),
          coverPath = cover,
          chapters = runCatching { parseChapters(name, bytes::read, bytes.size) }.getOrDefault(emptyList()),
          idTags = fileTags.ids,
          kind = kindTags(::tag, fileTags),
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
      val cover = embeddedCover(retriever, uri, coverDir)
      val (chapters, fileTags) = runCatching { fromFile(uri, name) }.getOrDefault(emptyList<Chapter>() to FileTags())
      return Tags(
        durationMs = tag(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L,
        title = tag(MediaMetadataRetriever.METADATA_KEY_TITLE),
        album = tag(MediaMetadataRetriever.METADATA_KEY_ALBUM),
        artist = tag(MediaMetadataRetriever.METADATA_KEY_ARTIST),
        albumArtist = tag(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST),
        coverPath = cover,
        chapters = chapters,
        idTags = fileTags.ids,
        kind = kindTags(::tag, fileTags),
      )
    } finally {
      retriever.release()
    }
  }

  /**
   * Saves an image file beside the audio (`cover.jpg`, `Book A.png`) as a small cover file, under
   * [fileName] when given, so the app can keep it between scans.
   */
  fun readImage(uri: Uri, coverDir: File, fileName: String? = null): String? {
    val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    return saveCover(bytes, uri, coverDir, fileName)
  }

  /**
   * An image's width and height from its header alone, for choosing among several images in a
   * folder; the pixels are never decoded. Null when Android can't tell.
   */
  fun imageSize(uri: Uri): Pair<Int, Int>? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: return null
    return if (bounds.outWidth > 0 && bounds.outHeight > 0) bounds.outWidth to bounds.outHeight else null
  }

  /** An odd picture or a full disk costs the cover only, never the book's title and duration. */
  private fun embeddedCover(retriever: MediaMetadataRetriever, uri: Uri, coverDir: File): String? =
    runCatching { retriever.embeddedPicture?.let { saveCover(it, uri, coverDir) } }.getOrNull()

  /** Chapters and the tags Android doesn't give, read from the file with our own parsers. */
  private fun fromFile(uri: Uri, name: String): Pair<List<Chapter>, FileTags> {
    val descriptor = context.contentResolver.openFileDescriptor(uri, "r") ?: return emptyList<Chapter>() to FileTags()
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
        return parseChapters(name, read, size) to IdTags.parseAll(name, read, size)
      }
    }
  }

  private fun parseChapters(name: String, read: (Long, Int) -> ByteArray, size: Long): List<Chapter> =
    when (name.substringAfterLast('.', "").lowercase()) {
      "mp3" -> Id3Chapters.parse(read, size)
      "m4a", "m4b", "mp4", "aac" -> Mp4Chapters.parse(read, size)
      else -> emptyList()
    }

  private fun saveCover(bytes: ByteArray, uri: Uri, coverDir: File, fileName: String? = null): String? {
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
    val file = File(coverDir, fileName ?: "${sha1(uri.toString())}.jpg")
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
    return file.absolutePath
  }

  private fun sha1(text: String) =
    MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
}
