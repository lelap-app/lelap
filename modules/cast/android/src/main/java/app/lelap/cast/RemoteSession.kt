package app.lelap.cast

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
) {
  sealed interface Command {
    data class Load(val index: Int, val positionMs: Long, val autoplay: Boolean, val speed: Float) : Command
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

  // A Load is out: statuses until it is done still describe the file before.
  private var loading = false

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
    val moved = if (advancing) ((now - positionAt) * speed).toLong() else 0L
    val place = positionMs + moved
    val length = durationOf(index)
    return if (length > 0) place.coerceAtMost(length) else place
  }

  /** The length of a part: the receiver's word for the one playing, else the tags'. */
  fun durationOf(i: Int): Long =
    if (i == index && receiverDurationMs > 0) receiverDurationMs else durations.getOrElse(i) { 0L }

  /** A book (again): loads [startIndex] at [startMs] on the receiver. */
  fun start(partDurations: List<Long>, startIndex: Int, startMs: Long, play: Boolean, speed: Float): List<Command> {
    durations = partDurations
    requestedSpeed = speed
    error = null
    if (durations.isEmpty()) {
      phase = Phase.IDLE
      playWhenReady = false
      return emptyList()
    }
    return load(startIndex.coerceIn(0, durations.lastIndex), startMs, play)
  }

  /** The owner finished running a [Command.Load]; [failure] says why it did not work. */
  fun onLoaded(failure: String?) {
    loading = false
    if (failure != null) {
      error = failure
      phase = Phase.IDLE
      playWhenReady = false
    }
  }

  fun onStatus(status: RendererStatus): List<Command> {
    if (status.volume != null) volume = status.volume
    if (loading) return emptyList()
    error = status.error
    when (status.state) {
      PlayState.ENDED -> return onPartEnded()
      PlayState.PLAYING -> {
        moveTo(status.positionMs, playing = true)
        phase = Phase.READY
        playWhenReady = true
      }
      PlayState.BUFFERING -> {
        moveTo(status.positionMs, playing = false)
        if (phase != Phase.ENDED) phase = Phase.BUFFERING
      }
      // Paused here or on the speaker itself (its app, its buttons).
      PlayState.PAUSED -> {
        moveTo(status.positionMs, playing = false)
        phase = Phase.READY
        playWhenReady = false
      }
      // Stopped without reaching the end: the place stays, and Play loads the file again.
      PlayState.IDLE -> if (phase != Phase.ENDED) {
        positionMs = position()
        positionAt = clock()
        receiverPlaying = false
        phase = Phase.IDLE
        playWhenReady = false
      }
    }
    if (status.durationMs > 0) receiverDurationMs = status.durationMs
    return emptyList()
  }

  fun play(): List<Command> {
    if (durations.isEmpty() || phase == Phase.ENDED) return emptyList()
    if (phase == Phase.IDLE && !loading) return load(index, position(), play = true)
    playWhenReady = true
    return listOf(Command.Play)
  }

  fun pause(): List<Command> {
    if (!playWhenReady) return emptyList()
    positionMs = position()
    positionAt = clock()
    receiverPlaying = false
    playWhenReady = false
    return listOf(Command.Pause)
  }

  fun seek(toIndex: Int, toMs: Long): List<Command> {
    if (durations.isEmpty()) return emptyList()
    val target = toIndex.coerceIn(0, durations.lastIndex)
    val place = toMs.coerceAtLeast(0L)
    if (target == index && !loading && (phase == Phase.READY || phase == Phase.BUFFERING)) {
      positionMs = place
      positionAt = clock()
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

  private fun onPartEnded(): List<Command> {
    if (phase == Phase.ENDED) return emptyList()
    val next = index + 1
    if (next < durations.size) return load(next, 0L, play = true)
    // The book's end: kept at the end of the last part, for the owner to log and hand on.
    positionMs = durationOf(index)
    positionAt = clock()
    receiverPlaying = false
    phase = Phase.ENDED
    playWhenReady = false
    return emptyList()
  }

  private fun load(target: Int, startMs: Long, play: Boolean): List<Command> {
    index = target
    positionMs = startMs
    positionAt = clock()
    receiverPlaying = false
    receiverDurationMs = 0L
    phase = Phase.BUFFERING
    playWhenReady = play
    loading = true
    return listOf(Command.Load(target, startMs, play, speed))
  }

  private fun moveTo(place: Long, playing: Boolean) {
    positionMs = place
    positionAt = clock()
    receiverPlaying = playing
  }
}
