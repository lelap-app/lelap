package app.lelap.cast

import app.lelap.text.NativeText
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * FCast, an open casting protocol (fcast.org): TCP port 46899, each packet a 4-byte
 * little-endian size (opcode plus body), a 1-byte opcode and an optional JSON body.
 */
object FCastProtocol {
  const val PORT = 46899
  const val PLAY = 1
  const val PAUSE = 2
  const val RESUME = 3
  const val STOP = 4
  const val SEEK = 5
  const val PLAYBACK_UPDATE = 6
  const val VOLUME_UPDATE = 7
  const val SET_VOLUME = 8
  const val PLAYBACK_ERROR = 9
  const val SET_SPEED = 10
  const val PING = 12
  const val PONG = 13

  private const val MAX_SIZE = 32 * 1024

  data class Packet(val opcode: Int, val body: String?)

  fun frame(opcode: Int, body: String? = null): ByteArray {
    val bytes = body?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
    val size = bytes.size + 1
    return byteArrayOf(size.toByte(), (size ushr 8).toByte(), (size ushr 16).toByte(), (size ushr 24).toByte(), opcode.toByte()) + bytes
  }

  fun read(input: DataInputStream): Packet {
    val size = Integer.reverseBytes(input.readInt())
    if (size < 1 || size > MAX_SIZE) throw IOException("Bad FCast packet size $size")
    val opcode = input.readUnsignedByte()
    val body = ByteArray(size - 1)
    input.readFully(body)
    return Packet(opcode, if (body.isEmpty()) null else String(body, Charsets.UTF_8))
  }

  fun play(media: CastMedia, startMs: Long, speed: Float): String = JSONObject()
    .put("container", media.mimeType)
    .put("url", media.url)
    .put("time", startMs / 1000.0)
    .put("speed", speed.toDouble())
    .toString()

  /** PlaybackUpdate's state: 0 idle, 1 playing, 2 paused. */
  fun playState(state: Int): PlayState = when (state) {
    1 -> PlayState.PLAYING
    2 -> PlayState.PAUSED
    else -> PlayState.IDLE
  }
}

/**
 * Whether an FCast receiver is still there (M125). How often a receiver sends playback updates
 * isn't fixed, so silence alone proves nothing: we ping every [PING_EVERY_MS], and only a receiver
 * that has answered a ping is held to it. Then the place stops moving on [GRACE_MS] after its last
 * word, and after [LOST_AFTER_MS] it counts as lost. One that never answers a ping keeps the place
 * moving until the connection drops, as before. Pure; times are on a monotonic clock.
 */
class FCastWatch(start: Long) {
  private var heardAt = start
  private var polledAt = start
  private var answersPings = false
  private var reported = false

  /** Anything came from the receiver; [pong] when it was the answer to a ping. */
  fun heard(now: Long, pong: Boolean) {
    heardAt = now
    if (pong) answersPings = true
  }

  /** Until when the place may move on from the last update. */
  fun placeUntil(now: Long): Long = if (answersPings) minOf(now, heardAt + GRACE_MS) else now

  /** A poll at [now]; true once, when a receiver that answers pings has been quiet too long. */
  fun polled(now: Long): Boolean {
    // A late poll (the phone slept, the thread stalled) gives the receiver a fresh chance.
    if (now - polledAt > POLL_GAP_MS) heardAt = maxOf(heardAt, now)
    polledAt = now
    if (!answersPings || reported || now - heardAt <= LOST_AFTER_MS) return false
    reported = true
    return true
  }

  companion object {
    const val PING_EVERY_MS = 3_000L
    /** Two pings: a pong comes at least one ping apart, so one alone would stall the place for a moment. */
    const val GRACE_MS = 2 * PING_EVERY_MS

    /** As for Google Cast: Chromium gives up on a channel after 10 s; we wait a little longer. */
    const val LOST_AFTER_MS = 15_000L

    /** Polls come every second; one this late means the poller, not the receiver, was away. */
    const val POLL_GAP_MS = 5_000L
  }
}

class FCastRenderer(private val device: CastDevice, private val onLost: (String) -> Unit) : Renderer {
  private val socket = Socket()
  private val out: BufferedOutputStream
  private val lock = Object()
  private val ends = EndWatch()
  private var closed = false
  private var state = PlayState.IDLE
  private var positionMs = 0L
  private var durationMs = 0L
  private var updatedAt = monotonicMs()
  private var speed = 1f
  private var volume: Float? = null
  private var error: String? = null
  private val watch = FCastWatch(monotonicMs())
  private val pinger: ScheduledExecutorService =
    Executors.newSingleThreadScheduledExecutor { Thread(it, "lelap-fcast-ping").apply { isDaemon = true } }

  init {
    // A receiver that can't be reached (a group's, say) must not leave a socket or threads behind.
    try {
      socket.connect(InetSocketAddress(device.host, device.port), 5_000)
    } catch (e: Exception) {
      pinger.shutdownNow()
      runCatching { socket.close() }
      throw e
    }
    out = BufferedOutputStream(socket.getOutputStream())
    Thread({ readLoop(DataInputStream(socket.getInputStream())) }, "lelap-fcast-reader").apply { isDaemon = true }.start()
    pinger.scheduleWithFixedDelay(
      { runCatching { send(FCastProtocol.PING) } },
      FCastWatch.PING_EVERY_MS,
      FCastWatch.PING_EVERY_MS,
      TimeUnit.MILLISECONDS,
    )
  }

  private fun send(opcode: Int, body: String? = null) {
    val frame = FCastProtocol.frame(opcode, body)
    synchronized(out) {
      out.write(frame)
      out.flush()
    }
  }

  private fun readLoop(input: DataInputStream) {
    try {
      while (true) {
        val packet = FCastProtocol.read(input)
        val body = packet.body?.let { runCatching { JSONObject(it) }.getOrNull() }
        synchronized(lock) { watch.heard(monotonicMs(), pong = packet.opcode == FCastProtocol.PONG) }
        when (packet.opcode) {
          FCastProtocol.PING -> send(FCastProtocol.PONG)
          FCastProtocol.PLAYBACK_UPDATE -> if (body != null) synchronized(lock) {
            state = FCastProtocol.playState(body.optInt("state"))
            positionMs = (body.optDouble("time", 0.0) * 1000).toLong()
            durationMs = (body.optDouble("duration", 0.0) * 1000).toLong()
            if (body.has("speed")) speed = body.getDouble("speed").toFloat()
            updatedAt = monotonicMs()
          }
          FCastProtocol.VOLUME_UPDATE -> if (body != null) synchronized(lock) { volume = body.optDouble("volume").toFloat() }
          FCastProtocol.PLAYBACK_ERROR -> synchronized(lock) { error = body?.optString("message") ?: NativeText.current().t("{name} could not play this file", "name" to device.name) }
        }
      }
    } catch (e: IOException) {
      val wasClosed = synchronized(lock) { closed.also { closed = true } }
      pinger.shutdownNow()
      if (!wasClosed) onLost(NativeText.current().t("Lost the connection to {name}", "name" to device.name))
    }
  }

  override fun load(media: CastMedia, startMs: Long, autoplay: Boolean, speed: Float) {
    synchronized(lock) {
      ends.reset()
      error = null
      state = PlayState.BUFFERING
      positionMs = startMs
      durationMs = media.durationMs
      this.speed = speed
    }
    send(FCastProtocol.PLAY, FCastProtocol.play(media, startMs, speed))
    if (!autoplay) pause()
  }

  override fun play() = send(FCastProtocol.RESUME)

  override fun pause() {
    synchronized(lock) { ends.reset() }
    send(FCastProtocol.PAUSE)
  }

  override fun seek(positionMs: Long) = send(FCastProtocol.SEEK, JSONObject().put("time", positionMs / 1000.0).toString())

  override fun setSpeed(speed: Float) = send(FCastProtocol.SET_SPEED, JSONObject().put("speed", speed.toDouble()).toString())

  override fun setVolume(level: Float) =
    send(FCastProtocol.SET_VOLUME, JSONObject().put("volume", level.coerceIn(0f, 1f).toDouble()).toString())

  override fun status(): RendererStatus {
    val now = monotonicMs()
    val (status, silent) = synchronized(lock) {
      val silent = watch.polled(now) && !closed
      // Between updates the place moves on at the speed, but not for long past the receiver's last word.
      val elapsed = if (state == PlayState.PLAYING) ((watch.placeUntil(now) - updatedAt).coerceAtLeast(0L) * speed).toLong() else 0L
      RendererStatus(ends.map(state), positionMs + elapsed, durationMs, volume, error) to silent
    }
    if (silent) onLost(NativeText.current().t("Lost the connection to {name}", "name" to device.name))
    return status
  }

  override fun close() {
    synchronized(lock) { closed = true }
    pinger.shutdownNow()
    runCatching { send(FCastProtocol.STOP) }
    runCatching { socket.close() }
  }

  private companion object {
    fun monotonicMs(): Long = System.nanoTime() / 1_000_000L
  }
}
