package app.lelap.cast

import android.annotation.SuppressLint
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager
import org.json.JSONArray
import org.json.JSONObject

/** Messages of the Cast v2 namespaces we speak, and what we read from the answers. */
object CastJson {
  const val CONNECTION = "urn:x-cast:com.google.cast.tp.connection"
  const val HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat"
  const val RECEIVER = "urn:x-cast:com.google.cast.receiver"
  const val MEDIA = "urn:x-cast:com.google.cast.media"

  /** Google's Default Media Receiver, which plays a URL with no app of our own registered. */
  const val DEFAULT_MEDIA_RECEIVER = "CC1AD845"

  data class App(val sessionId: String, val transportId: String)

  data class ReceiverStatus(val app: App?, val volume: Float?)

  data class MediaStatus(
    val mediaSessionId: Int,
    val playerState: String,
    val idleReason: String?,
    val currentTimeMs: Long,
    val durationMs: Long?,
    val playbackRate: Float,
  )

  fun type(payload: String): String? = runCatching { JSONObject(payload).optString("type").ifEmpty { null } }.getOrNull()

  fun receiverStatus(payload: String): ReceiverStatus? = runCatching {
    val status = JSONObject(payload).getJSONObject("status")
    val apps = status.optJSONArray("applications") ?: JSONArray()
    val app = (0 until apps.length()).map { apps.getJSONObject(it) }
      .firstOrNull { it.optString("appId") == DEFAULT_MEDIA_RECEIVER }
      ?.let { App(it.getString("sessionId"), it.getString("transportId")) }
    val volume = status.optJSONObject("volume")?.let { if (it.has("level")) it.getDouble("level").toFloat() else null }
    ReceiverStatus(app, volume)
  }.getOrNull()

  /** The first media session in a MEDIA_STATUS; null when there is none. */
  fun mediaStatus(payload: String): MediaStatus? = runCatching {
    val list = JSONObject(payload).getJSONArray("status")
    if (list.length() == 0) return null
    val s = list.getJSONObject(0)
    MediaStatus(
      mediaSessionId = s.getInt("mediaSessionId"),
      playerState = s.optString("playerState", "IDLE"),
      idleReason = s.optString("idleReason").ifEmpty { null },
      currentTimeMs = (s.optDouble("currentTime", 0.0) * 1000).toLong(),
      durationMs = s.optJSONObject("media")?.optDouble("duration")?.takeIf { !it.isNaN() && it > 0 }?.let { (it * 1000).toLong() },
      playbackRate = s.optDouble("playbackRate", 1.0).toFloat(),
    )
  }.getOrNull()

  fun playState(status: MediaStatus?): PlayState = when (status?.playerState) {
    "PLAYING" -> PlayState.PLAYING
    "PAUSED" -> PlayState.PAUSED
    "BUFFERING", "LOADING" -> PlayState.BUFFERING
    "IDLE" -> if (status.idleReason == "FINISHED") PlayState.ENDED else PlayState.IDLE
    else -> PlayState.IDLE
  }

  fun load(requestId: Int, media: CastMedia, startMs: Long, autoplay: Boolean, speed: Float): String {
    val metadata = JSONObject()
      // 3: MusicTrackMediaMetadata, which shows title, artist and album art.
      .put("metadataType", 3)
      .put("title", media.title)
    media.artist?.let { metadata.put("artist", it) }
    media.album?.let { metadata.put("albumName", it) }
    media.coverUrl?.let { metadata.put("images", JSONArray().put(JSONObject().put("url", it))) }
    val item = JSONObject()
      .put("contentId", media.url)
      .put("contentUrl", media.url)
      .put("contentType", media.mimeType)
      .put("streamType", "BUFFERED")
      .put("metadata", metadata)
    if (media.durationMs > 0) item.put("duration", media.durationMs / 1000.0)
    return JSONObject()
      .put("type", "LOAD")
      .put("requestId", requestId)
      .put("media", item)
      .put("autoplay", autoplay)
      .put("currentTime", startMs / 1000.0)
      .put("playbackRate", speed.toDouble())
      .toString()
  }
}

/**
 * Cast devices present a self-signed TLS certificate; who they are is shown by device
 * authentication ([CastAuth]) instead, which only reports for now. Only control messages and LAN
 * URLs go over this socket.
 */
@SuppressLint("CustomX509TrustManager", "TrustAllX509TrustManager")
internal object TrustDevice : X509TrustManager {
  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/**
 * Our own sender for the open Cast v2 protocol, as VLC has: TLS to port 8009, the Default Media
 * Receiver, and the media namespace. No Google Cast SDK, so no Play services.
 */
class GoogleCastRenderer(private val device: CastDevice, private val onLost: (String) -> Unit) : Renderer {
  private val sender = "sender-lelap"
  private val lock = Object()
  private val socket: SSLSocket
  private val out: BufferedOutputStream
  private val heartbeat: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { Thread(it, "lelap-cast-heartbeat") }
  private var requestId = 1
  private var closed = false

  // Guarded by [lock]; written by the reader thread.
  private var app: CastJson.App? = null
  private var receiverVolume: Float? = null
  private var media: CastJson.MediaStatus? = null
  private var mediaAt = 0L
  private var loadError: String? = null
  private var loadedRequest = -1

  // When the receiver last sent anything. It answers a status request every second and a ping
  // every 5 s, so a long silence means it is gone without closing the connection.
  private var heardAt = System.currentTimeMillis()
  private var lostReported = false

  private var current: CastMedia? = null

  init {
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf(TrustDevice), SecureRandom())
    socket = context.socketFactory.createSocket() as SSLSocket
    socket.connect(InetSocketAddress(device.host, device.port), 5_000)
    socket.soTimeout = 0
    socket.startHandshake()
    out = BufferedOutputStream(socket.outputStream)
    Thread({ readLoop(DataInputStream(socket.inputStream)) }, "lelap-cast-reader").apply { isDaemon = true }.start()
    send(RECEIVER_ID, CastJson.CONNECTION, JSONObject().put("type", "CONNECT").toString())
    heartbeat.scheduleWithFixedDelay({
      runCatching { send(RECEIVER_ID, CastJson.HEARTBEAT, PING) }
    }, 0, 5, TimeUnit.SECONDS)
    sendRequest(RECEIVER_ID, CastJson.RECEIVER, JSONObject().put("type", "GET_STATUS"))
  }

  private fun send(destination: String, namespace: String, payload: String) {
    val frame = CastMessage.frame(CastMessage(sender, destination, namespace, payload))
    synchronized(out) {
      out.write(frame)
      out.flush()
    }
  }

  private fun sendRequest(destination: String, namespace: String, payload: JSONObject): Int {
    val id = synchronized(lock) { requestId++ }
    send(destination, namespace, payload.put("requestId", id).toString())
    return id
  }

  private fun readLoop(input: DataInputStream) {
    try {
      while (true) {
        val message = CastMessage.read(input)
        synchronized(lock) { heardAt = System.currentTimeMillis() }
        handle(message)
      }
    } catch (e: IOException) {
      val wasClosed = synchronized(lock) { closed.also { closed = true; lock.notifyAll() } }
      if (!wasClosed) onLost("Lost the connection to ${device.name}")
    }
  }

  private fun handle(message: CastMessage) {
    // Binary payloads only come from device authentication, which runs on its own connection.
    if (message.binary != null) return
    when (message.namespace) {
      CastJson.HEARTBEAT -> if (CastJson.type(message.payload) == "PING") {
        runCatching { send(message.sourceId, CastJson.HEARTBEAT, PONG) }
      }
      CastJson.RECEIVER -> CastJson.receiverStatus(message.payload)?.let { status ->
        synchronized(lock) {
          app = status.app
          if (status.volume != null) receiverVolume = status.volume
          lock.notifyAll()
        }
      }
      CastJson.MEDIA -> {
        val payload = JSONObject(message.payload)
        when (payload.optString("type")) {
          "MEDIA_STATUS" -> synchronized(lock) {
            CastJson.mediaStatus(message.payload)?.let {
              media = it
              mediaAt = System.currentTimeMillis()
            }
            if (payload.optInt("requestId") == loadedRequest) loadedRequest = -1
            lock.notifyAll()
          }
          "LOAD_FAILED", "LOAD_CANCELLED", "INVALID_REQUEST" -> synchronized(lock) {
            loadError = "${device.name} could not play this file (${payload.optString("type")})"
            lock.notifyAll()
          }
        }
      }
      CastJson.CONNECTION -> if (CastJson.type(message.payload) == "CLOSE" && message.sourceId != RECEIVER_ID) {
        // The media app went away (another phone took the speaker, or it was stopped there).
        synchronized(lock) {
          app = null
          media = null
          lock.notifyAll()
        }
      }
    }
  }

  private fun awaitApp(): CastJson.App {
    synchronized(lock) { app }?.let { return it }
    sendRequest(RECEIVER_ID, CastJson.RECEIVER, JSONObject().put("type", "LAUNCH").put("appId", CastJson.DEFAULT_MEDIA_RECEIVER))
    val deadline = System.currentTimeMillis() + 20_000
    synchronized(lock) {
      while (app == null && !closed) {
        val left = deadline - System.currentTimeMillis()
        if (left <= 0) throw CastException("${device.name} did not start its media player")
        lock.wait(left)
      }
      return app ?: throw CastException("Lost the connection to ${device.name}")
    }
  }

  override fun load(media: CastMedia, startMs: Long, autoplay: Boolean, speed: Float) {
    val app = awaitApp()
    send(app.transportId, CastJson.CONNECTION, JSONObject().put("type", "CONNECT").toString())
    current = media
    val id = synchronized(lock) {
      loadError = null
      this.media = null
      requestId++.also { loadedRequest = it }
    }
    send(app.transportId, CastJson.MEDIA, CastJson.load(id, media, startMs, autoplay, speed))
    val deadline = System.currentTimeMillis() + 20_000
    synchronized(lock) {
      while (loadedRequest == id && loadError == null && !closed) {
        val left = deadline - System.currentTimeMillis()
        if (left <= 0) throw CastException("${device.name} did not answer")
        lock.wait(left)
      }
      loadError?.let { throw CastException(it) }
    }
  }

  private fun mediaCommand(type: String, extra: JSONObject.() -> Unit = {}) {
    val (app, session) = synchronized(lock) { app to media?.mediaSessionId }
    if (app == null || session == null) return
    sendRequest(app.transportId, CastJson.MEDIA, JSONObject().put("type", type).put("mediaSessionId", session).apply(extra))
  }

  override fun play() = mediaCommand("PLAY")

  override fun pause() = mediaCommand("PAUSE")

  override fun seek(positionMs: Long) = mediaCommand("SEEK") { put("currentTime", positionMs / 1000.0) }

  override fun setSpeed(speed: Float) = mediaCommand("SET_PLAYBACK_RATE") { put("playbackRate", speed.toDouble()) }

  override fun setVolume(level: Float) {
    sendRequest(
      RECEIVER_ID,
      CastJson.RECEIVER,
      JSONObject().put("type", "SET_VOLUME").put("volume", JSONObject().put("level", level.coerceIn(0f, 1f).toDouble())),
    )
  }

  override fun status(): RendererStatus {
    val app = synchronized(lock) { app }
    if (app != null) runCatching { sendRequest(app.transportId, CastJson.MEDIA, JSONObject().put("type", "GET_STATUS")) }
    val now = System.currentTimeMillis()
    val silent = synchronized(lock) { (now - heardAt > LIVENESS_MS && !closed && !lostReported).also { if (it) lostReported = true } }
    if (silent) onLost("Lost the connection to ${device.name}")
    synchronized(lock) {
      val m = media
      val state = CastJson.playState(m)
      // Statuses come when something changes; between them the place moves on at the play rate,
      // but not for long past the receiver's last word.
      val until = minOf(now, heardAt + SILENCE_GRACE_MS)
      val elapsed = if (state == PlayState.PLAYING) ((until - mediaAt).coerceAtLeast(0L) * (m?.playbackRate ?: 1f)).toLong() else 0L
      return RendererStatus(
        state = state,
        positionMs = (m?.currentTimeMs ?: 0L) + elapsed,
        durationMs = m?.durationMs ?: current?.durationMs ?: 0L,
        volume = receiverVolume,
      )
    }
  }

  override fun close() {
    val app = synchronized(lock) { closed = true; lock.notifyAll(); app }
    runCatching {
      if (app != null) {
        send(RECEIVER_ID, CastJson.RECEIVER, JSONObject().put("type", "STOP").put("sessionId", app.sessionId).put("requestId", 0).toString())
      }
      send(RECEIVER_ID, CastJson.CONNECTION, JSONObject().put("type", "CLOSE").toString())
    }
    heartbeat.shutdownNow()
    runCatching { socket.close() }
  }

  private companion object {
    const val RECEIVER_ID = "receiver-0"

    /** Chromium gives up on a Cast channel after 10 s without a message; we wait a little longer. */
    const val LIVENESS_MS = 15_000L
    const val SILENCE_GRACE_MS = 3_000L
    const val PING = "{\"type\":\"PING\"}"
    const val PONG = "{\"type\":\"PONG\"}"
  }
}
