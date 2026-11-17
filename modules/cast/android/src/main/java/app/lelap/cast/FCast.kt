package app.lelap.cast

import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
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

class FCastRenderer(private val device: CastDevice, private val onLost: (String) -> Unit) : Renderer {
  private val socket = Socket()
  private val out: BufferedOutputStream
  private val lock = Object()
  private val ends = EndWatch()
  private var closed = false
  private var state = PlayState.IDLE
  private var positionMs = 0L
  private var durationMs = 0L
  private var updatedAt = 0L
  private var speed = 1f
  private var volume: Float? = null
  private var error: String? = null

  init {
    socket.connect(InetSocketAddress(device.host, device.port), 5_000)
    out = BufferedOutputStream(socket.getOutputStream())
    Thread({ readLoop(DataInputStream(socket.getInputStream())) }, "lelap-fcast-reader").apply { isDaemon = true }.start()
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
        when (packet.opcode) {
          FCastProtocol.PING -> send(FCastProtocol.PONG)
          FCastProtocol.PLAYBACK_UPDATE -> if (body != null) synchronized(lock) {
            state = FCastProtocol.playState(body.optInt("state"))
            positionMs = (body.optDouble("time", 0.0) * 1000).toLong()
            durationMs = (body.optDouble("duration", 0.0) * 1000).toLong()
            if (body.has("speed")) speed = body.getDouble("speed").toFloat()
            updatedAt = System.currentTimeMillis()
          }
          FCastProtocol.VOLUME_UPDATE -> if (body != null) synchronized(lock) { volume = body.optDouble("volume").toFloat() }
          FCastProtocol.PLAYBACK_ERROR -> synchronized(lock) { error = body?.optString("message") ?: "${device.name} could not play this file" }
        }
      }
    } catch (e: IOException) {
      val wasClosed = synchronized(lock) { closed.also { closed = true } }
      if (!wasClosed) onLost("Lost the connection to ${device.name}")
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

  override fun status(): RendererStatus = synchronized(lock) {
    val mapped = ends.map(state)
    val elapsed = if (state == PlayState.PLAYING) ((System.currentTimeMillis() - updatedAt) * speed).toLong() else 0L
    RendererStatus(mapped, positionMs + elapsed, durationMs, volume, error)
  }

  override fun close() {
    synchronized(lock) { closed = true }
    runCatching { send(FCastProtocol.STOP) }
    runCatching { socket.close() }
  }
}
