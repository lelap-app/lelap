package app.lelap.audio

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.util.Locale

/**
 * What the player does at one moment, as the tally needs it. [playing]: audio is coming out (not
 * buffering, not paused), so the time counts. [engaged]: the listener wants it to play, so a
 * buffering pause does not end the scrobble session.
 */
data class Heard(
  val bookId: String,
  val title: String,
  val fileIndex: Int,
  val fileLocation: String,
  val positionMs: Long,
  val playing: Boolean,
  val engaged: Boolean,
  val speed: Float,
  /** The player stopped at the book's end. */
  val ended: Boolean = false,
)

/** One entry of the [AccountingLog]; [seq] grows by one per entry and is never reused. */
sealed interface AccountingRecord {
  val seq: Long
}

/** Listening time for a book on a local day (`YYYY-MM-DD`). */
data class Listened(override val seq: Long, val bookId: String, val title: String, val day: String, val ms: Long) :
  AccountingRecord

/** A scrobble session event: `start`, `progress` or `pause`, at a wall-clock time and file place. */
data class SessionEvent(
  override val seq: Long,
  val kind: String,
  val bookId: String,
  val at: Long,
  val fileLocation: String,
  val filePositionMs: Long,
  val startLocation: String?,
  val startPositionMs: Long?,
) : AccountingRecord

/** The scrobble session playing now; kept in the log so a pause can be sent after process death. */
data class OpenSession(
  val bookId: String,
  val startLocation: String,
  val startPositionMs: Long,
  val lastLocation: String,
  val lastPositionMs: Long,
  val lastAt: Long,
  /** Elapsed-realtime of the last `start` or `progress`; meaningless after a reboot. */
  val reportedElapsedMs: Long,
)

/**
 * What the service heard, waiting for the app. The app takes a snapshot ([take]), merges it into
 * its database together with the highest [AccountingRecord.seq] it merged, then acknowledges
 * ([ack]). Records handed out are never changed afterwards, so a record is merged exactly once
 * even when the app dies between merging and acknowledging. [epoch] tells a fresh log (cleared
 * app data) from the old one, whose numbers the app may already have seen.
 */
class AccountingLog(
  val epoch: String,
  private var nextSeq: Long = 1L,
  /** Records up to this one were handed out and stay as they are. */
  private var sealedThrough: Long = 0L,
  records: List<AccountingRecord> = emptyList(),
  var session: OpenSession? = null,
) {
  private val list = records.toMutableList()
  val records: List<AccountingRecord>
    get() = list

  fun addListening(bookId: String, title: String, day: String, ms: Long) {
    if (ms <= 0) return
    // A total per book and day grows while nobody has seen it, also with events after it, so
    // weeks with the app closed stay one record per book and day.
    val total = list.indexOfLast { it is Listened && it.seq > sealedThrough && it.bookId == bookId && it.day == day }
    if (total >= 0) {
      val r = list[total] as Listened
      list[total] = r.copy(ms = r.ms + ms, title = title)
      return
    }
    list += Listened(nextSeq++, bookId, title, day, ms)
    trim()
  }

  fun addEvent(kind: String, bookId: String, at: Long, location: String, positionMs: Long, start: Pair<String, Long>?) {
    // Only the latest progress of a session nobody has seen yet matters: it replaces the one before.
    if (kind == PROGRESS) {
      list.removeAll {
        it is SessionEvent && it.seq > sealedThrough && it.kind == PROGRESS && it.bookId == bookId &&
          it.startLocation == start?.first && it.startPositionMs == start?.second
      }
    }
    list += SessionEvent(nextSeq++, kind, bookId, at, location, positionMs, start?.first, start?.second)
    trim()
  }

  /** Everything not yet acknowledged; from now on these records stay as they are. */
  fun take(): List<AccountingRecord> {
    sealedThrough = nextSeq - 1
    return list.toList()
  }

  /** The app merged everything up to [through] of [epoch]; a different epoch is an old log's. */
  fun ack(epoch: String, through: Long) {
    if (epoch != this.epoch) return
    list.removeAll { it.seq <= through }
  }

  // Weeks without opening the app: progress events go first, they matter least.
  private fun trim() {
    var excess = list.size - MAX_RECORDS
    if (excess <= 0) return
    val iterator = list.iterator()
    while (excess > 0 && iterator.hasNext()) {
      val r = iterator.next()
      if (r is SessionEvent && r.kind == PROGRESS) {
        iterator.remove()
        excess--
      }
    }
    while (list.size > MAX_RECORDS) list.removeAt(0)
  }

  fun encode(): String = JSONObject()
    .put("epoch", epoch)
    .put("nextSeq", nextSeq)
    .put("sealedThrough", sealedThrough)
    .put("records", JSONArray(list.map(::encodeRecord)))
    .put("session", session?.let(::encodeSession) ?: JSONObject.NULL)
    .toString()

  companion object {
    const val START = "start"
    const val PROGRESS = "progress"
    const val PAUSE = "pause"
    const val MAX_RECORDS = 3_000

    /** The saved log, or a fresh one with [newEpoch] when there is none or it can't be read. */
    fun decode(json: String?, newEpoch: () -> String): AccountingLog {
      if (json == null) return AccountingLog(newEpoch())
      return try {
        val o = JSONObject(json)
        val array = o.getJSONArray("records")
        AccountingLog(
          epoch = o.getString("epoch"),
          nextSeq = o.getLong("nextSeq"),
          sealedThrough = o.getLong("sealedThrough"),
          records = List(array.length()) { decodeRecord(array.getJSONObject(it)) },
          session = if (o.isNull("session")) null else decodeSession(o.getJSONObject("session")),
        )
      } catch (e: JSONException) {
        // A new epoch: the app can't have merged anything of it yet.
        AccountingLog(newEpoch())
      }
    }

    private fun encodeRecord(r: AccountingRecord): JSONObject = when (r) {
      is Listened -> JSONObject()
        .put("seq", r.seq)
        .put("kind", "listen")
        .put("bookId", r.bookId)
        .put("title", r.title)
        .put("day", r.day)
        .put("ms", r.ms)
      is SessionEvent -> JSONObject()
        .put("seq", r.seq)
        .put("kind", r.kind)
        .put("bookId", r.bookId)
        .put("at", r.at)
        .put("fileLocation", r.fileLocation)
        .put("filePositionMs", r.filePositionMs)
        .put("startLocation", r.startLocation ?: JSONObject.NULL)
        .put("startPositionMs", r.startPositionMs ?: JSONObject.NULL)
    }

    private fun decodeRecord(o: JSONObject): AccountingRecord = when (val kind = o.getString("kind")) {
      "listen" -> Listened(o.getLong("seq"), o.getString("bookId"), o.getString("title"), o.getString("day"), o.getLong("ms"))
      else -> SessionEvent(
        o.getLong("seq"),
        kind,
        o.getString("bookId"),
        o.getLong("at"),
        o.getString("fileLocation"),
        o.getLong("filePositionMs"),
        if (o.isNull("startLocation")) null else o.getString("startLocation"),
        if (o.isNull("startPositionMs")) null else o.getLong("startPositionMs"),
      )
    }

    private fun encodeSession(s: OpenSession): JSONObject = JSONObject()
      .put("bookId", s.bookId)
      .put("startLocation", s.startLocation)
      .put("startPositionMs", s.startPositionMs)
      .put("lastLocation", s.lastLocation)
      .put("lastPositionMs", s.lastPositionMs)
      .put("lastAt", s.lastAt)
      .put("reportedElapsedMs", s.reportedElapsedMs)

    private fun decodeSession(o: JSONObject) = OpenSession(
      o.getString("bookId"),
      o.getString("startLocation"),
      o.getLong("startPositionMs"),
      o.getString("lastLocation"),
      o.getLong("lastPositionMs"),
      o.getLong("lastAt"),
      o.getLong("reportedElapsedMs"),
    )
  }
}

/**
 * Turns what the player does into listening time and scrobble events, like the app's own counting
 * on the web (`listenedBetween` and `ScrobbleTracker` in `@lelap/core`). Time is measured on the
 * elapsed-realtime clock, so changing the phone's clock moves no listening; the wall clock only
 * names the day and stamps the events.
 */
class ListeningTally(
  /** The local day (`YYYY-MM-DD`) of a wall-clock time. */
  private val dayOf: (Long) -> String,
  private val progressEveryMs: Long = PROGRESS_INTERVAL_MS,
) {
  private data class Anchor(val heard: Heard, val elapsedMs: Long)

  // Only in memory: after process death the time since the last record is lost, never doubled.
  private var anchor: Anchor? = null

  // The book and start of the session last seen playing, kept past the pause the end itself logs.
  private var stretch: Pair<String, Pair<String, Long>>? = null

  /**
   * The player as it is now ([heard] null: nothing of a known book is loaded). Credits the time
   * since the last observation, at most the position's advance, so seeks and skips add nothing.
   */
  fun observe(log: AccountingLog, heard: Heard?, elapsedMs: Long, wallMs: Long) {
    val a = anchor
    if (a != null && heard != null && heard.bookId == a.heard.bookId) {
      val ms = credit(a, heard, elapsedMs)
      if (ms > 0) log.addListening(heard.bookId, heard.title, dayOf(wallMs), ms)
    }
    anchor = heard?.takeIf { it.playing }?.let { Anchor(it, elapsedMs) }
    track(log, heard, elapsedMs, wallMs)
    val open = log.session
    stretch = when {
      open != null -> open.bookId to (open.startLocation to open.startPositionMs)
      heard != null && heard.ended && stretch?.first == heard.bookId -> stretch
      // A pause or another book: a later stretch the tally never sees has no start known.
      else -> null
    }
  }

  /**
   * Where the session that reached the end of [bookId] began, for its `finish`: the open one, or
   * the one the end itself closed; never an earlier one. Null when unknown.
   */
  fun finishStart(log: AccountingLog, bookId: String): Pair<String, Long>? {
    log.session?.takeIf { it.bookId == bookId }?.let { return it.startLocation to it.startPositionMs }
    return stretch?.takeIf { it.first == bookId }?.second
  }

  /** A jump (seek, next file): the time up to [before] counts, then counting goes on from [after]. */
  fun jumped(log: AccountingLog, before: Heard?, after: Heard?, elapsedMs: Long, wallMs: Long) {
    if (before == null) return observe(log, after, elapsedMs, wallMs)
    observe(log, before, elapsedMs, wallMs)
    if (after == null || after.bookId != before.bookId) return
    if (anchor != null) anchor = Anchor(after, elapsedMs)
    log.session?.let { s ->
      if (after.bookId == s.bookId) {
        log.session = s.copy(lastLocation = after.fileLocation, lastPositionMs = after.positionMs, lastAt = wallMs)
      }
    }
  }

  /**
   * A new service: a session the last one left open (the process died while playing) ends with a
   * pause at the last place it saw.
   */
  fun recover(log: AccountingLog) {
    anchor = null
    stretch = null
    val s = log.session ?: return
    log.addEvent(AccountingLog.PAUSE, s.bookId, s.lastAt, s.lastLocation, s.lastPositionMs, s.startLocation to s.startPositionMs)
    log.session = null
  }

  private fun credit(a: Anchor, now: Heard, elapsedMs: Long): Long {
    val wall = elapsedMs - a.elapsedMs
    if (wall <= 0) return 0L
    val advance = if (now.fileIndex == a.heard.fileIndex && now.fileLocation == a.heard.fileLocation) {
      now.positionMs - a.heard.positionMs
    } else {
      now.positionMs
    }
    if (advance <= 0) return 0L
    // The speed the interval played at; a change is observed as it happens.
    return minOf(wall.toDouble(), advance / maxOf(0.5, a.heard.speed.toDouble())).toLong()
  }

  // start when a book starts playing, progress about every five minutes, pause when it stops or
  // another book takes over; finish comes from the service's end-of-book log.
  private fun track(log: AccountingLog, heard: Heard?, elapsedMs: Long, wallMs: Long) {
    val engaged = heard?.takeIf { it.engaged }
    val s = log.session
    if (s != null && (engaged == null || engaged.bookId != s.bookId)) {
      val same = heard?.takeIf { it.bookId == s.bookId }
      log.addEvent(
        AccountingLog.PAUSE,
        s.bookId,
        wallMs,
        same?.fileLocation ?: s.lastLocation,
        same?.positionMs ?: s.lastPositionMs,
        s.startLocation to s.startPositionMs,
      )
      log.session = null
    }
    if (engaged == null) return
    val open = log.session
    if (open == null) {
      log.session = OpenSession(
        engaged.bookId, engaged.fileLocation, engaged.positionMs,
        engaged.fileLocation, engaged.positionMs, wallMs, elapsedMs,
      )
      log.addEvent(AccountingLog.START, engaged.bookId, wallMs, engaged.fileLocation, engaged.positionMs, null)
      return
    }
    val due = elapsedMs - open.reportedElapsedMs >= progressEveryMs
    log.session = open.copy(
      lastLocation = engaged.fileLocation,
      lastPositionMs = engaged.positionMs,
      lastAt = wallMs,
      reportedElapsedMs = if (due) elapsedMs else open.reportedElapsedMs,
    )
    if (due) {
      log.addEvent(
        AccountingLog.PROGRESS, engaged.bookId, wallMs, engaged.fileLocation, engaged.positionMs,
        open.startLocation to open.startPositionMs,
      )
    }
  }

  companion object {
    /** Matches `SCROBBLE_PROGRESS_MS` in `@lelap/core`. */
    const val PROGRESS_INTERVAL_MS = 5 * 60 * 1000L
  }
}

/** Local calendar days, without java.time (API 26). */
object LocalDay {
  private const val DAY_MS = 86_400_000L

  /** `YYYY-MM-DD` of [wallMs] at a time zone offset of [offsetMs]. */
  fun key(wallMs: Long, offsetMs: Int): String {
    // Howard Hinnant's days-to-civil.
    val z = Math.floorDiv(wallMs + offsetMs, DAY_MS) + 719_468
    val era = Math.floorDiv(z, 146_097L)
    val doe = z - era * 146_097
    val yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val day = doy - (153 * mp + 2) / 5 + 1
    val month = if (mp < 10) mp + 3 else mp - 9
    val year = yoe + era * 400 + if (month <= 2) 1 else 0
    // ASCII digits whatever the phone's language: the app reads the day as YYYY-MM-DD.
    return String.format(Locale.ROOT, "%04d-%02d-%02d", year, month, day)
  }
}
