package app.lelap.text

import org.json.JSONObject

/**
 * The lines native code shows, in one language: English → translation, as the app's catalogs have
 * them. A missing or empty line shows the English, like `t()` in the app.
 */
class NativeCatalog(val language: String, private val lines: Map<String, String>) {
  /** [english] in this language, with `{holes}` filled from [vars]. */
  fun t(english: String, vararg vars: Pair<String, Any>): String {
    val line = lines[english]?.takeIf { it.isNotEmpty() } ?: english
    if (vars.isEmpty()) return line
    return HOLE.replace(line) { match ->
      vars.firstOrNull { it.first == match.groupValues[1] }?.second?.toString() ?: match.value
    }
  }

  fun encode(): String = JSONObject().put("language", language).put("lines", JSONObject(lines)).toString()

  companion object {
    private val HOLE = Regex("""\{(\w+)\}""")

    val ENGLISH = NativeCatalog("en", emptyMap())

    /** English when nothing was saved yet or the saved value can't be read. */
    fun decode(json: String?): NativeCatalog {
      if (json.isNullOrBlank()) return ENGLISH
      val o = runCatching { JSONObject(json) }.getOrNull() ?: return ENGLISH
      val saved = o.optJSONObject("lines") ?: return ENGLISH
      val lines = saved.keys().asSequence().associateWith { saved.optString(it) }
      return NativeCatalog(o.optString("language").ifEmpty { "en" }, lines)
    }
  }
}
