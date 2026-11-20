package app.lelap.audio

import androidx.media3.common.Metadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.metadata.icy.IcyInfo
import androidx.media3.extractor.metadata.id3.TextInformationFrame

/**
 * Live streams (M154): a station plays from what is on air, keeps no place and has no speed or
 * seeking. What it plays now comes from Icecast and Shoutcast ICY metadata, or from an HLS
 * playlist's timed ID3 tags; both reach the player as [Metadata].
 */
@UnstableApi
object LiveStream {
  private val HLS_MIMES = setOf("application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl")

  /** The line under the station's name, from the metadata the stream just sent; null for none. */
  fun lineOf(metadata: Metadata): String? {
    var streamTitle: String? = null
    var title: String? = null
    var artist: String? = null
    for (i in 0 until metadata.length()) {
      when (val entry = metadata.get(i)) {
        is IcyInfo -> streamTitle = entry.title
        is TextInformationFrame -> when (entry.id) {
          "TIT2" -> title = entry.values.firstOrNull()
          "TPE1" -> artist = entry.values.firstOrNull()
        }
      }
    }
    return line(streamTitle, title, artist)
  }

  /** As `nowPlayingLine` in `@lelap/core`: the ICY title, else “Artist - Title”. */
  fun line(streamTitle: String?, title: String?, artist: String?): String? {
    fun clean(s: String?) = s?.replace(Regex("\\s+"), " ")?.trim()?.takeIf { it.isNotEmpty() }
    val icy = clean(streamTitle)
    if (icy != null && icy != "-") return icy
    val t = clean(title)
    val a = clean(artist)
    return if (t != null && a != null) "$a - $t" else t ?: a
  }

  /** The MIME type ExoPlayer needs for an HLS playlist whose address has no `.m3u8`; else null. */
  fun mimeFor(uri: String, mime: String?): String? {
    val type = mime?.substringBefore(';')?.trim()?.lowercase()
    if (type != null) return if (type in HLS_MIMES) MimeTypes.APPLICATION_M3U8 else null
    val path = runCatching { java.net.URI(uri).path }.getOrNull() ?: uri.substringBefore('?')
    return if (path.lowercase().endsWith(".m3u8")) MimeTypes.APPLICATION_M3U8 else null
  }
}
