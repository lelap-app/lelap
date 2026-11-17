package app.lelap.cast

import android.content.Context
import android.net.wifi.WifiManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class CastFailedException(message: String) : CodedException(message)

/**
 * Bridges JavaScript to one cast session at a time. Every network call to the receiver runs on
 * one thread, in order; a poll every second reports the receiver's state as `onStatus`.
 */
class CastModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val worker = Executors.newSingleThreadScheduledExecutor { Thread(it, "lelap-cast").apply { isDaemon = true } }
  private var discovery: Discovery? = null
  private var server: MediaServer? = null
  private var renderer: Renderer? = null
  private var device: CastDevice? = null
  private var poll: ScheduledFuture<*>? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var lastStatus: RendererStatus? = null

  private fun discovery(): Discovery = discovery ?: Discovery(context) { list ->
    sendEvent(DEVICES_EVENT, mapOf("devices" to list.map { it.toMap() }))
  }.also { discovery = it }

  /** Runs [block] on the cast thread and waits, so calls never overlap a poll. */
  private fun <T> onWorker(block: () -> T): T = try {
    worker.submit(Callable { block() }).get()
  } catch (e: ExecutionException) {
    val cause = e.cause
    throw CastFailedException(if (cause is CastException) cause.message.orEmpty() else (cause?.message ?: "Casting failed"))
  }

  override fun definition() = ModuleDefinition {
    Name("LelapCast")
    Events(DEVICES_EVENT, STATUS_EVENT)

    AsyncFunction("startDiscovery") { discovery().start() }

    AsyncFunction("stopDiscovery") { discovery?.stop() }

    AsyncFunction("devices") { discovery().devices().map { it.toMap() } }

    AsyncFunction("connect") { deviceId: String ->
      val target = discovery().device(deviceId) ?: throw CastFailedException("That speaker is no longer on the network")
      onWorker {
        closeSession()
        renderer = when (target.kind) {
          "upnp" -> UpnpRenderer(target)
          "cast" -> GoogleCastRenderer(target, ::lost)
          "fcast" -> FCastRenderer(target, ::lost)
          else -> throw CastException("Unknown kind of receiver")
        }
        device = target
        lastStatus = null
        holdWifi(true)
        poll = worker.scheduleWithFixedDelay({ pollStatus() }, 1, 1, TimeUnit.SECONDS)
      }
    }

    // The media travels as JSON: { uri, title, artist, album, coverUri, durationMs, headers }.
    AsyncFunction("load") { mediaJson: String, startMs: Double, autoplay: Boolean, speed: Double ->
      onWorker {
        val r = renderer ?: throw CastException("Not casting")
        r.load(media(JSONObject(mediaJson)), startMs.toLong(), autoplay, speed.toFloat())
      }
    }

    AsyncFunction("play") { onWorker { renderer?.play() } }

    AsyncFunction("pause") { onWorker { renderer?.pause() } }

    AsyncFunction("seek") { positionMs: Double -> onWorker { renderer?.seek(positionMs.toLong().coerceAtLeast(0L)) } }

    AsyncFunction("setSpeed") { speed: Double -> onWorker { renderer?.setSpeed(speed.toFloat()) } }

    AsyncFunction("setVolume") { level: Double -> onWorker { renderer?.setVolume(level.toFloat()) } }

    AsyncFunction("status") { onWorker { renderer?.let { statusMap(it.status()) } } }

    // Returns the last place, so the phone can carry on from there.
    AsyncFunction("disconnect") {
      onWorker {
        val last = runCatching { renderer?.status() }.getOrNull() ?: lastStatus
        closeSession()
        last?.positionMs?.toDouble()
      }
    }

    OnDestroy {
      worker.execute { closeSession() }
      discovery?.stop()
    }
  }

  private fun media(json: JSONObject): CastMedia {
    val uri = json.getString("uri")
    val headers = json.optJSONObject("headers")?.let { h -> h.keys().asSequence().associateWith { h.getString(it) } }.orEmpty()
    val title = json.getString("title")
    val local = uri.startsWith("file://") || uri.startsWith("content://")
    val needsServer = local || headers.isNotEmpty()
    val name = if (local) server().displayName(uri) else uri
    val mimeType = Mime.audioOr(json.optString("mimeType").ifEmpty { null }, name)
    val url = when {
      local -> server().publish(MediaServer.Source.Local(uri), mimeType, name)
      needsServer -> server().publish(MediaServer.Source.Remote(uri, headers), mimeType, name)
      else -> uri
    }
    val cover = json.optString("coverUri").ifEmpty { null }?.let { c ->
      when {
        c.startsWith("file://") || c.startsWith("content://") -> {
          val coverName = server().displayName(c)
          server().publish(MediaServer.Source.Local(c), Mime.image(coverName), coverName)
        }
        c.startsWith("http://") || c.startsWith("https://") -> c
        else -> null
      }
    }
    return CastMedia(
      url = url,
      mimeType = mimeType,
      title = title,
      artist = json.optString("artist").ifEmpty { null },
      album = json.optString("album").ifEmpty { null },
      coverUrl = cover,
      durationMs = json.optLong("durationMs", 0L),
    )
  }

  private fun server(): MediaServer = server ?: MediaServer(context).also { server = it }

  private fun pollStatus() {
    val r = renderer ?: return
    val status = try {
      r.status()
    } catch (e: Exception) {
      lastStatus?.copy(error = e.message) ?: return
    }
    lastStatus = status
    sendEvent(STATUS_EVENT, statusMap(status))
  }

  private fun statusMap(status: RendererStatus): Map<String, Any?> = mapOf(
    "deviceId" to device?.id,
    "state" to status.state.name.lowercase(),
    "positionMs" to status.positionMs.toDouble(),
    "durationMs" to status.durationMs.toDouble(),
    "volume" to status.volume?.toDouble(),
    "error" to status.error,
  )

  /** The receiver closed the connection; the app hands playback back to the phone. */
  private fun lost(message: String) {
    worker.execute {
      val id = device?.id ?: return@execute
      val position = lastStatus?.positionMs ?: 0L
      closeSession()
      sendEvent(
        STATUS_EVENT,
        mapOf("deviceId" to id, "state" to "lost", "positionMs" to position.toDouble(), "durationMs" to 0.0, "volume" to null, "error" to message),
      )
    }
  }

  private fun closeSession() {
    poll?.cancel(false)
    poll = null
    runCatching { renderer?.close() }
    renderer = null
    device = null
    server?.stop()
    holdWifi(false)
  }

  private fun holdWifi(hold: Boolean) {
    if (hold && wifiLock == null) {
      val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
      @Suppress("DEPRECATION")
      wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "lelap-cast").apply {
        setReferenceCounted(false)
        acquire()
      }
    } else if (!hold) {
      wifiLock?.let { if (it.isHeld) it.release() }
      wifiLock = null
    }
  }

  private companion object {
    const val DEVICES_EVENT = "onDevices"
    const val STATUS_EVENT = "onStatus"
  }
}
