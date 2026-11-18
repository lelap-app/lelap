package app.lelap.audio

import org.json.JSONObject

/**
 * A book's or show's own voice boost, skip silence and even loudness (M84); null follows the
 * listener's default. Mirrors `SoundOverrides` and `chooseSound` in `@lelap/core`.
 */
data class SoundOverrides(
  val voiceEq: Boolean? = null,
  val skipSilence: Boolean? = null,
  val evenLoudness: Boolean? = null,
) {
  fun toJson(): JSONObject = JSONObject().apply {
    voiceEq?.let { put("voiceEq", it) }
    skipSilence?.let { put("skipSilence", it) }
    evenLoudness?.let { put("evenLoudness", it) }
  }

  companion object {
    /** Only booleans count; anything else, or a missing object, follows the default. */
    fun fromJson(o: JSONObject?): SoundOverrides {
      if (o == null) return SoundOverrides()
      fun flag(key: String): Boolean? = o.opt(key) as? Boolean
      return SoundOverrides(flag("voiceEq"), flag("skipSilence"), flag("evenLoudness"))
    }
  }
}

/** What plays, after a book's own choices are laid over the listener's defaults. */
data class SoundChoice(
  val voiceEq: Boolean = false,
  val skipSilence: Boolean = false,
  val evenLoudness: Boolean = false,
) {
  fun with(overrides: SoundOverrides?): SoundChoice = SoundChoice(
    voiceEq = overrides?.voiceEq ?: voiceEq,
    skipSilence = overrides?.skipSilence ?: skipSilence,
    evenLoudness = overrides?.evenLoudness ?: evenLoudness,
  )
}
