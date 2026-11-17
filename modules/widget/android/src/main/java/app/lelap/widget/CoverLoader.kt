package app.lelap.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Loads the cover for the widget, from its host or a local file, and keeps the last one. */
object CoverLoader {
  private const val MAX_PX = 320
  private const val MAX_BYTES = 8 * 1024 * 1024
  private const val TIMEOUT_MS = 4_000
  private const val PREFIX = "widget-cover-"

  /** Call off the main thread. Null when there is no cover or it can't be loaded. */
  fun load(context: Context, uri: String?): Bitmap? {
    if (uri.isNullOrBlank()) return null
    val cached = File(context.cacheDir, PREFIX + sha1(uri))
    if (!cached.exists()) {
      val bytes = runCatching { fetch(context, uri) }.getOrNull() ?: return null
      // One cover is enough: the widget only shows the book that plays now.
      context.cacheDir.listFiles { f -> f.name.startsWith(PREFIX) }?.forEach { it.delete() }
      runCatching { cached.writeBytes(bytes) }
      return decode(bytes)
    }
    return runCatching { decode(cached.readBytes()) }.getOrNull()
  }

  private fun decode(bytes: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val options = BitmapFactory.Options().apply { inSampleSize = Models.sampleSize(bounds.outWidth, bounds.outHeight, MAX_PX) }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  private fun fetch(context: Context, uri: String): ByteArray? {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme?.lowercase()) {
      "http", "https" -> {
        val connection = URL(uri).openConnection() as HttpURLConnection
        connection.connectTimeout = TIMEOUT_MS
        connection.readTimeout = TIMEOUT_MS
        connection.setRequestProperty("User-Agent", "Lelap")
        try {
          if (connection.responseCode !in 200..299) null else connection.inputStream.use(::readCapped)
        } finally {
          connection.disconnect()
        }
      }
      "content", "file", "android.resource" -> context.contentResolver.openInputStream(parsed)?.use(::readCapped)
      else -> null
    }
  }

  private fun readCapped(input: InputStream): ByteArray? {
    val bytes = input.readNBytesCompat(MAX_BYTES + 1)
    return bytes.takeIf { it.size <= MAX_BYTES }
  }

  private fun InputStream.readNBytesCompat(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    while (out.size() < limit) {
      val read = read(buffer, 0, minOf(buffer.size, limit - out.size()))
      if (read < 0) break
      out.write(buffer, 0, read)
    }
    return out.toByteArray()
  }

  private fun sha1(value: String): String =
    MessageDigest.getInstance("SHA-1").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
