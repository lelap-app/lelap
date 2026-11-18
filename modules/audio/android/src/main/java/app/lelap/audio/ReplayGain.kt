package app.lelap.audio

/**
 * ReplayGain from a file's tags (M84), for even loudness. Tags come as name and value, whatever
 * the container: ID3 `TXXX`, Vorbis comments (FLAC, Ogg, Opus) and MP4 freeform atoms all name
 * them the same way.
 */
object ReplayGain {
  private val DECIBELS = Regex("""^\s*([+-]?\d+(?:\.\d+)?)\s*(?:dB)?\s*$""", RegexOption.IGNORE_CASE)
  private const val LIMIT_DB = 20f
  /** Opus's R128 gains aim at -23 LUFS, ReplayGain 2 at -18. */
  private const val R128_TO_REPLAYGAIN_DB = 5f

  /**
   * The gain in dB, or null when the tags carry none. The album gain comes first: a book's parts
   * then keep the level they were mastered at against each other.
   */
  fun gainDb(tags: List<Pair<String, String>>): Float? {
    val byName = tags.associate { (name, value) -> name.trim().uppercase() to value }
    return decibels(byName["REPLAYGAIN_ALBUM_GAIN"])
      ?: decibels(byName["REPLAYGAIN_TRACK_GAIN"])
      ?: r128(byName["R128_ALBUM_GAIN"])
      ?: r128(byName["R128_TRACK_GAIN"])
  }

  private fun decibels(value: String?): Float? {
    val match = value?.let { DECIBELS.find(it) } ?: return null
    return match.groupValues[1].toFloatOrNull()?.takeIf { it in -LIMIT_DB..LIMIT_DB }
  }

  /** A Q7.8 number: 256 is 1 dB. */
  private fun r128(value: String?): Float? {
    val q78 = value?.trim()?.toIntOrNull() ?: return null
    return (q78 / 256f + R128_TO_REPLAYGAIN_DB).takeIf { it in -LIMIT_DB..LIMIT_DB }
  }
}
