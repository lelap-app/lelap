package app.lelap.cast

object Mime {
  // Receivers know audio/mp4, not audio/x-m4b: audiobooks in m4b are plain MPEG-4 audio.
  private val AUDIO = mapOf(
    "mp3" to "audio/mpeg",
    "m4a" to "audio/mp4",
    "m4b" to "audio/mp4",
    "mp4" to "audio/mp4",
    "aac" to "audio/aac",
    "ogg" to "audio/ogg",
    "oga" to "audio/ogg",
    "opus" to "audio/ogg",
    "flac" to "audio/flac",
    "wav" to "audio/wav",
    "webm" to "audio/webm",
  )
  private val IMAGE = mapOf("jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "webp" to "image/webp")

  /** The extension of a path, URL or file name, lower case; query and fragment ignored. */
  fun extension(name: String): String {
    val path = name.substringBefore('#').substringBefore('?').substringAfterLast('/')
    val dot = path.lastIndexOf('.')
    return if (dot < 0) "" else path.substring(dot + 1).lowercase()
  }

  /**
   * The name to take a file's type and extension from: its address or local name when that has
   * an audio extension, else [fileName] when that has one (a Subsonic stream address has none, a
   * downloaded part may be `.audio`).
   */
  fun nameFor(addressName: String, fileName: String?): String = when {
    AUDIO.containsKey(extension(addressName)) -> addressName
    fileName != null && AUDIO.containsKey(extension(fileName)) -> fileName
    else -> addressName
  }

  fun audio(name: String): String = AUDIO[extension(name)] ?: "audio/mpeg"

  fun image(name: String): String = IMAGE[extension(name)] ?: "image/jpeg"

  private val HLS = setOf("application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl")

  /** Receivers ask for these names; a server's own type wins only when it is audio. */

  fun audioOr(serverType: String?, name: String): String {
    val type = serverType?.substringBefore(';')?.trim()?.lowercase()
    val fromName = AUDIO[extension(name)]
    return when {
      // An HLS playlist (M154), which a receiver plays as a stream of segments.
      type in HLS || extension(name) == "m3u8" -> "application/x-mpegurl"
      fromName != null -> fromName
      type == "audio/x-m4b" || type == "audio/x-m4a" -> "audio/mp4"
      type != null && type.startsWith("audio/") -> type
      else -> "audio/mpeg"
    }
  }
}
