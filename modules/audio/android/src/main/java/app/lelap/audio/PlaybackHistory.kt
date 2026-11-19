package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * One action for the playback history (M138), as the service saw it: whole-book places before and
 * after, wall-clock time. Names match `HistoryAction` and `HistorySource` in
 * `packages/core/src/history.ts`, which merges skips, keeps 50 per book and decides the rest.
 */
data class HistoryReport(
  val bookId: String,
  val action: String,
  val source: String,
  val at: Long,
  val fromMs: Long,
  val toMs: Long,
)

/**
 * The service's buffer of actions made away from the app (notification, headphones, car, watch,
 * widget, the sleep timer), kept in [Commands.AUDIO_PREFS] so they survive with the app closed.
 * The app takes them when it wakes, as it takes finished books. The app's own taps it logs itself.
 */
object PlaybackHistory {
  /** A night of headphone presses fits; the app takes them long before. */
  const val LIMIT = 200

  const val PLAY = "play"
  const val PAUSE = "pause"
  const val SKIP = "skip"
  const val SEEK = "seek"
  const val TIMER = "timer"
  const val SLEEP = "sleep"

  const val NOTIFICATION = "notification"
  const val HEADPHONES = "headphones"
  const val WIDGET = "widget"
  const val CAR = "car"
  const val WATCH = "watch"
  const val SHAKE = "shake"
  const val SLEEP_TIMER = "timer"
  const val OTHER = "other"

  /** Media3's name for a platform controller whose app it can't tell; headphones are marked apart. */
  private const val LEGACY = "android.media.session.MediaController"

  /**
   * Where a command came from, by the controller that sent it; null for the app itself, which
   * logs its own taps with what they were (a chapter, a bookmark).
   */
  fun sourceOf(
    packageName: String,
    ownPackage: String,
    isApp: Boolean,
    isNotification: Boolean,
    isCar: Boolean,
  ): String? = when {
    isApp -> null
    isNotification -> NOTIFICATION
    isCar -> CAR
    packageName == ownPackage -> WIDGET
    packageName == "com.android.systemui" -> NOTIFICATION
    packageName == "com.android.bluetooth" -> HEADPHONES
    packageName.startsWith("com.google.android.projection") -> CAR
    packageName.contains("wearable") || packageName.contains(".wear") -> WATCH
    packageName == LEGACY -> OTHER
    else -> OTHER
  }

  fun append(json: String?, entry: HistoryReport): String = encode((decode(json) + entry).takeLast(LIMIT))

  fun encode(list: List<HistoryReport>): String = JSONArray().apply {
    for (e in list) {
      put(
        JSONObject()
          .put("bookId", e.bookId)
          .put("action", e.action)
          .put("source", e.source)
          .put("at", e.at)
          .put("fromMs", e.fromMs)
          .put("toMs", e.toMs),
      )
    }
  }.toString()

  fun decode(json: String?): List<HistoryReport> {
    if (json.isNullOrEmpty()) return emptyList()
    return try {
      val array = JSONArray(json)
      List(array.length()) { i ->
        val o = array.getJSONObject(i)
        HistoryReport(
          bookId = o.getString("bookId"),
          action = o.getString("action"),
          source = o.getString("source"),
          at = o.getLong("at"),
          fromMs = o.getLong("fromMs"),
          toMs = o.getLong("toMs"),
        )
      }
    } catch (e: JSONException) {
      emptyList()
    }
  }
}

/**
 * The notification's and car's “Back” (M138): for 30 s after a jump of more than a minute made
 * away from the app, one press goes back to where the listener was. A run of skips counts from
 * its first place. Nothing goes back by itself.
 */
class BackOffer(private val clock: () -> Long) {
  data class Offer(val bookId: String, val fromMs: Long, val untilMs: Long)

  private var run: Offer? = null

  /** The place to go back to while the offer stands, else null. */
  var offer: Offer? = null
    private set

  /**
   * A skip or seek moved [bookId] from [fromMs] to [toMs]. [external] is false for the app's own
   * jumps, which offer going back on the screen instead. Returns whether the button changes.
   */
  fun jumped(bookId: String, fromMs: Long, toMs: Long, external: Boolean): Boolean {
    val before = offer
    val now = clock()
    if (!external) {
      run = null
      offer = null
      return before != null
    }
    val last = run?.takeIf { it.bookId == bookId && now < it.untilMs }
    val start = last?.fromMs ?: fromMs
    run = Offer(bookId, start, now + SHOWN_MS)
    offer = if (kotlin.math.abs(toMs - start) > JUMP_MS) run else null
    return (before == null) != (offer == null)
  }

  /** Whether the offer ran out now; the caller then puts the usual button back. */
  fun expire(): Boolean {
    val o = offer ?: return false
    if (clock() < o.untilMs) return false
    offer = null
    run = null
    return true
  }

  /** The listener pressed Back, or loaded another book: the offer goes. */
  fun clear() {
    offer = null
    run = null
  }

  companion object {
    const val SHOWN_MS = 30_000L
    const val JUMP_MS = 60_000L
  }
}
