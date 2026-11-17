package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * One player event for the app's diagnostics log (M47). Only a word from [Diagnostics], numbers
 * and the book's row ID: no title, file or address, so the log can't carry one.
 */
data class DiagnosticEntry(
  val at: Long,
  val what: String,
  val code: Int? = null,
  val status: Int? = null,
  val bookId: String? = null,
  val part: Int? = null,
)

/**
 * The service's part of the diagnostics log, kept in [Commands.AUDIO_PREFS] while the app has it
 * on, so events with the app closed are not lost. The app takes them when it exports.
 */
object Diagnostics {
  /** The service keeps its newest events only; the app's own log keeps more. */
  const val LIMIT = 200

  const val ERROR = "error"
  const val LINK_REFRESHED = "link-refreshed"
  const val PAUSED_BY_SYSTEM = "paused-by-system"

  /** Media3's play-when-ready reason for a press of Play or Pause; those are not logged. */
  const val REASON_USER_REQUEST = 1
  const val REASON_END_OF_MEDIA_ITEM = 5

  /** Losing focus; getting it back is left out, like everything that only says someone listens. */
  fun focusEvent(action: FocusAction): String? = when (action) {
    FocusAction.PAUSE -> "focus-lost"
    FocusAction.PAUSE_TRANSIENT -> "focus-lost-briefly"
    FocusAction.DUCK -> "focus-ducked"
    FocusAction.RESTORE -> null
  }

  /**
   * A pause the listener did not ask for (focus, unplugged headphones), or null: presses of Play
   * and Pause, and the end of a book, say when someone listens, which is theirs, not the log's.
   */
  fun pauseEvent(playWhenReady: Boolean, reason: Int): String? = when {
    playWhenReady -> null
    reason == REASON_USER_REQUEST || reason == REASON_END_OF_MEDIA_ITEM -> null
    else -> PAUSED_BY_SYSTEM
  }

  fun append(json: String?, entry: DiagnosticEntry, limit: Int = LIMIT): String =
    encode((decode(json) + entry).takeLast(limit))

  fun encode(list: List<DiagnosticEntry>): String = JSONArray(
    list.map { e ->
      JSONObject().put("at", e.at).put("what", e.what).apply {
        e.code?.let { put("code", it) }
        e.status?.let { put("status", it) }
        e.bookId?.let { put("bookId", it) }
        e.part?.let { put("part", it) }
      }
    },
  ).toString()

  /** Unreadable logs read as empty; unreadable entries are left out. */
  fun decode(json: String?): List<DiagnosticEntry> {
    val array = try {
      JSONArray(json ?: "[]")
    } catch (e: JSONException) {
      return emptyList()
    }
    return (0 until array.length()).mapNotNull { i ->
      try {
        val o = array.getJSONObject(i)
        DiagnosticEntry(
          at = o.getLong("at"),
          what = o.getString("what"),
          code = if (o.has("code")) o.getInt("code") else null,
          status = if (o.has("status")) o.getInt("status") else null,
          bookId = if (o.has("bookId")) o.getString("bookId") else null,
          part = if (o.has("part")) o.getInt("part") else null,
        )
      } catch (e: JSONException) {
        null
      }
    }
  }
}
