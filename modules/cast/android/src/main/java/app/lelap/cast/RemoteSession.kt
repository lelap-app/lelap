package app.lelap.cast

import kotlin.math.abs

/**
 * A book playing on a receiver, which plays one file at a time. Decides what the receiver is told
 * when a part ends (the next part, or the book's end), on play, pause, seek and speed, and what
 * the phone shows meanwhile. Pure and single-threaded: the owner runs the returned [Command]s on
 * the receiver, in order, and feeds back [onStatus] and [onLoaded].
 */
class RemoteSession(
  private val clock: () -> Long,
  /** Whether the receiver plays at this speed; UPnP renderers often only at 1×. */
  private val canPlayAt: (Float) -> Boolean,
  /** How long the receiver took to agree with a command, for tuning the waits below on real ones. */
  private val onTiming: (Timing) -> Unit = {},
) {
  /**
   * [what] is `play`, `pause`, `seek` or `load`: [ms] until the first status that agreed. For
   * `part-end` and `stop`: how far before the part's end the receiver stopped.
   */
  data class Timing(val what: String, val ms: Long)

  sealed interface Command {
    /** [seq] goes back with [onLoaded], so a load that a newer one replaced is ignored. */
    data class Load(val index: Int, val positionMs: Long, val autoplay: Boolean, val speed: Float, val seq: Int) : Command
    data object Play : Command
    data object Pause : Command
    data class Seek(val positionMs: Long) : Command
    data class SetSpeed(val speed: Float) : Command
  }

  enum class Phase {
    /** Nothing loaded yet, or the receiver stopped the file by itself. */
    IDLE,
    BUFFERING,
    READY,
    /** The last part played to its end. */
    ENDED,
  }

  private var durations: List<Long> = emptyList()

  var index = 0
    private set
  var phase = Phase.IDLE
    private set
  var playWhenReady = false
    private set
  var requestedSpeed = 1f
    private set

  /** 0..1 as the receiver last said; null when it does not say. */
  var volume: Float? = null
    private set

  /** Why the receiver could not play, as it said. */
  var error: String? = null
    private set

  // The place, as of [positionAt] on [clock]; it moves on at [speed] while the receiver plays.
  private var positionMs = 0L
  private var positionAt = 0L
  private var receiverPlaying = false
  private var receiverDurationMs = 0L

  // When the receiver last said anything; the place stops moving on soon after it falls silent.
  private var heardAt = 0L

  // The place the receiver itself last reported (or a seek or load set), for noticing that
  // playback crossed the outro rather than was moved past it.
  private var reportedMs = 0L

  /** Where a podcast's outro starts in the last part (M45); playback that reaches it ends the book. */
  private var outroAtMs: Long? = null

  private var probe: Probe? = null

  // A Load is out: statuses until it is done still describe the file before.
  private var loading = false
  private var loadSeq = 0

  // Polls run on another thread and may predate the last command. For a moment after one, a
  // status that contradicts it (and, after a seek or load, its place) is taken as stale.
  private var stateHoldUntil = 0L
  private var placeHoldUntil = 0L

  /** The speed the receiver plays at: the book's, or 1× where the receiver cannot. */
  val speed: Float
    get() = if (canPlayAt(requestedSpeed)) requestedSpeed else 1f

  val partCount: Int
    get() = durations.size

  /** Whether the place moves on by itself now. */
  val advancing: Boolean
    get() = playWhenReady && receiverPlaying && phase == Phase.READY && !loading

  fun position(): Long {
    val now = clock()
    // A receiver that drops off without a word: no more than [SILENCE_GRACE_MS] past its last word
    // counts, so the place doesn't run on until the lost link is noticed.
    val until = minOf(now, maxOf(positionAt, heardAt) + SILENCE_GRACE_MS)
    val moved = if (advancing) ((until - positionAt).coerceAtLeast(0L) * speed).toLong() else 0L
    val place = positionMs + moved
    val length = durationOf(index)
    return if (length > 0) place.coerceAtMost(length) else place
  }

  /** The length of a part: the receiver's word for the one playing, else the tags'. */
  fun durationOf(i: Int): Long =
    if (i == index && receiverDurationMs > 0) receiverDurationMs else durations.getOrElse(i) { 0L }

  /** A book (again): loads [startIndex] at [startMs] on the receiver. */
  fun start(
    partDurations: List<Long>,
    startIndex: Int,
    startMs: Long,
    play: Boolean,
    speed: Float,
    outroAtMs: Long? = null,
  ): List<Command> {
    durations = partDurations
    requestedSpeed = speed
    error = null
    this.outroAtMs = outroAtMs
    if (durations.isEmpty()) {
      phase = Phase.IDLE
      playWhenReady = false
      return emptyList()
    }
    return load(startIndex.coerceIn(0, durations.lastIndex), startMs, play)
  }

  /** The owner finished running the [Command.Load] numbered [seq]; [failure] says why it did not work. */
  fun onLoaded(seq: Int, failure: String?): Boolean {
    if (seq != loadSeq) return false
    loading = false
    if (failure != null) {
      error = failure
      phase = Phase.IDLE
      playWhenReady = false
      return true
    }
    // Receivers report a stop or an idle moment while they start the new file.
    hold(state = LOAD_SETTLE_MS, place = LOAD_SETTLE_MS)
    expect("load") { it.state == (if (playWhenReady) PlayState.PLAYING else PlayState.PAUSED) }
    return true
  }

  /** The show's outro changed while its episode plays: where it starts in the last part, or null. */
  fun setOutro(atMs: Long?) {
    outroAtMs = atMs
  }

  fun onStatus(status: RendererStatus): List<Command> {
    if (status.volume != null) volume = status.volume
    if (loading) return emptyList()
    val now = clock()
    measure(status, now)
    // The place moved on until now; from here it moves on from this status.
    positionMs = position()
    positionAt = now
    heardAt = now
    // Ended (the last part, or at the outro): only a new load or seek starts it again.
    if (phase == Phase.ENDED) return emptyList()
    if (now < stateHoldUntil && contradicts(status.state)) return emptyList()
    val held = now < placeHoldUntil
    val place = if (held) position() else status.positionMs
    error = status.error
    when (status.state) {
      PlayState.ENDED -> return onPartEnded()
      PlayState.PLAYING -> {
        moveTo(place, playing = true)
        phase = Phase.READY
        playWhenReady = true
        val before = reportedMs
        if (!held) reportedMs = place
        if (crossedOutro(before, place)) return endAtOutro()
      }
      PlayState.BUFFERING -> {
        moveTo(place, playing = false)
        if (phase != Phase.ENDED) phase = Phase.BUFFERING
      }
      // Paused here or on the speaker itself (its app, its buttons).
      PlayState.PAUSED -> {
        moveTo(place, playing = false)
        phase = Phase.READY
        playWhenReady = false
        if (!held) reportedMs = place
      }
      // Stopped without reaching the end: the place stays, and Play loads the file again.
      PlayState.IDLE -> if (phase != Phase.ENDED) stop()
    }
    if (status.durationMs > 0) receiverDurationMs = status.durationMs
    return emptyList()
  }

  /**
   * Play, from [resumeAtMs] in the current part when smart rewind moved the place back. The seek
   * goes first and the receiver buffers once, before it plays; a stopped receiver loads the file
   * there, so it never starts at the old place and then jumps.
   */
  fun play(resumeAtMs: Long? = null): List<Command> {
    if (durations.isEmpty() || phase == Phase.ENDED) return emptyList()
    val resume = resumeAtMs?.coerceAtLeast(0L)
    if (phase == Phase.IDLE && !loading) return load(index, resume ?: position(), play = true)
    val commands = mutableListOf<Command>()
    if (resume != null && !loading) {
      positionMs = resume
      positionAt = clock()
      reportedMs = resume
      receiverPlaying = false
      hold(place = COMMAND_SETTLE_MS)
      commands += Command.Seek(resume)
    }
    playWhenReady = true
    hold(state = COMMAND_SETTLE_MS)
    expect("play") { it.state == PlayState.PLAYING }
    commands += Command.Play
    return commands
  }

  fun pause(): List<Command> {
    if (!playWhenReady) return emptyList()
    positionMs = position()
    positionAt = clock()
    receiverPlaying = false
    playWhenReady = false
    hold(state = COMMAND_SETTLE_MS, place = COMMAND_SETTLE_MS)
    expect("pause") { it.state == PlayState.PAUSED }
    return listOf(Command.Pause)
  }

  fun seek(toIndex: Int, toMs: Long): List<Command> {
    if (durations.isEmpty()) return emptyList()
    val target = toIndex.coerceIn(0, durations.lastIndex)
    val place = toMs.coerceAtLeast(0L)
    if (target == index && !loading && (phase == Phase.READY || phase == Phase.BUFFERING)) {
      positionMs = place
      positionAt = clock()
      reportedMs = place
      hold(place = COMMAND_SETTLE_MS)
      expect("seek") { it.state != PlayState.BUFFERING && abs(it.positionMs - place) <= SEEK_MATCH_MS }
      return listOf(Command.Seek(place))
    }
    return load(target, place, playWhenReady)
  }

  fun setSpeed(value: Float): List<Command> {
    val before = speed
    positionMs = position()
    positionAt = clock()
    requestedSpeed = value
    return if (speed != before) listOf(Command.SetSpeed(speed)) else emptyList()
  }

  // A stop counts as the end of the part only near its end: a stop pressed on the TV's remote
  // mid-part must not skip ahead or mark the book finished.
  private fun onPartEnded(): List<Command> {
    if (phase == Phase.ENDED) return emptyList()
    val length = durationOf(index)
    if (length > 0) onTiming(Timing(if (position() < length - END_TOLERANCE_MS) "stop" else "part-end", length - position()))
    if (length > 0 && position() < length - END_TOLERANCE_MS) {
      stop()
      return emptyList()
    }
    val next = index + 1
    if (next < durations.size) return load(next, 0L, play = true)
    // The book's end: kept at the end of the last part, for the owner to log and hand on.
    positionMs = length
    positionAt = clock()
    receiverPlaying = false
    phase = Phase.ENDED
    playWhenReady = false
    return emptyList()
  }

  private fun crossedOutro(before: Long, place: Long): Boolean {
    val at = outroAtMs ?: return false
    return index == durations.lastIndex && before < at && place >= at
  }

  // Like the end of the last part: the receiver pauses, the place goes to the end, and the owner
  // logs the episode as played and hands on to Up Next.
  private fun endAtOutro(): List<Command> {
    positionMs = durationOf(index)
    positionAt = clock()
    receiverPlaying = false
    phase = Phase.ENDED
    playWhenReady = false
    probe = null
    return listOf(Command.Pause)
  }

  private fun stop() {
    positionMs = position()
    positionAt = clock()
    receiverPlaying = false
    phase = Phase.IDLE
    playWhenReady = false
  }

  private fun load(target: Int, startMs: Long, play: Boolean): List<Command> {
    index = target
    positionMs = startMs
    positionAt = clock()
    receiverPlaying = false
    receiverDurationMs = 0L
    reportedMs = startMs
    phase = Phase.BUFFERING
    playWhenReady = play
    probe = null
    loading = true
    loadSeq += 1
    return listOf(Command.Load(target, startMs, play, speed, loadSeq))
  }

  private fun moveTo(place: Long, playing: Boolean) {
    positionMs = place
    positionAt = clock()
    receiverPlaying = playing
  }

  private fun hold(state: Long = 0L, place: Long = 0L) {
    val now = clock()
    if (state > 0) stateHoldUntil = now + state
    if (place > 0) placeHoldUntil = now + place
  }

  private class Probe(val what: String, val at: Long, val agrees: (RendererStatus) -> Boolean)

  private fun expect(what: String, agrees: (RendererStatus) -> Boolean) {
    probe = Probe(what, clock(), agrees)
  }

  private fun measure(status: RendererStatus, now: Long) {
    val p = probe ?: return
    if (now - p.at > PROBE_LIMIT_MS) {
      probe = null
      return
    }
    if (!p.agrees(status)) return
    probe = null
    onTiming(Timing(p.what, now - p.at))
  }

  private fun contradicts(state: PlayState): Boolean = when (state) {
    PlayState.PLAYING -> !playWhenReady
    PlayState.PAUSED, PlayState.IDLE, PlayState.ENDED -> playWhenReady
    PlayState.BUFFERING -> false
  }

  private companion object {
    const val COMMAND_SETTLE_MS = 2_500L
    const val LOAD_SETTLE_MS = 5_000L

    /** How far before a part's end a stop still counts as its end: polls are a second apart. */
    const val END_TOLERANCE_MS = 10_000L

    /** Polls come every second; a receiver silent for longer than this may be gone. */
    const val SILENCE_GRACE_MS = 3_000L

    /** A seek counts as done once the receiver reports a place this close to it. */
    const val SEEK_MATCH_MS = 2_000L

    /** A command the receiver never agreed with within this long isn't measured. */
    const val PROBE_LIMIT_MS = 30_000L
  }
}
