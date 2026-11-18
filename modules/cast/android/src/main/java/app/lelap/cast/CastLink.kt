package app.lelap.cast

import android.content.Context
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.util.Log
import java.util.concurrent.Callable
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** A file for the receiver as the player knows it; [CastLink] turns it into a URL the receiver can fetch. */
data class CastRequest(
  val uri: String,
  val title: String,
  val artist: String?,
  val album: String?,
  val coverUri: String?,
  val durationMs: Long,
  val headers: Map<String, String> = emptyMap(),
  val mimeType: String? = null,
  /** The address carries a login (a Subsonic token): the receiver gets it through the phone. */
  val viaPhone: Boolean = false,
  /** The file's own name, whose extension tells the type when the address has none (Subsonic). */
  val fileName: String? = null,
) {
  /** Whether the receiver fetches this file from the phone, which adds the login on the way. */
  val throughPhone: Boolean
    get() = headers.isNotEmpty() || viaPhone
}

/**
 * One cast session: the receiver's protocol client, the phone's file server and the locks that
 * keep both reachable with the screen off. Process-wide, so the app's bridge (which connects) and
 * the playback service (which plays through it) share it. Every call to the receiver runs on one
 * thread, in order; a poll every second reports its state to the listeners on that thread.
 */
class CastLink private constructor(
  context: Context,
  val device: CastDevice,
) {
  interface Listener {
    fun onStatus(status: RendererStatus)

    /** The session is over: handed back ([error] null) or lost. */
    fun onClosed(error: String?)
  }

  private val app = context.applicationContext
  private val worker = Executors.newSingleThreadScheduledExecutor { Thread(it, "lelap-cast").apply { isDaemon = true } }
  private val listeners = CopyOnWriteArraySet<Listener>()
  @Volatile
  private var renderer: Renderer? = null
  private val closing = AtomicBoolean(false)
  private var server: MediaServer? = null
  private var poll: ScheduledFuture<*>? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var wakeLock: PowerManager.WakeLock? = null

  @Volatile
  var closed = false
    private set

  @Volatile
  var lastStatus: RendererStatus? = null
    private set

  fun addListener(listener: Listener) {
    listeners += listener
  }

  fun removeListener(listener: Listener) {
    listeners -= listener
  }

  /** Whether the receiver plays at [speed]; asked on the main thread, so no network here. */
  fun canPlayAt(speed: Float): Boolean = renderer?.canPlayAt(speed) ?: false

  /** Runs [block] on the cast thread; a failure goes to [onError] on that thread. */
  fun run(onError: (String) -> Unit = {}, block: (Renderer) -> Unit) {
    later {
      val r = renderer ?: return@later
      if (closed) return@later
      try {
        block(r)
      } catch (e: Exception) {
        onError(message(e))
      }
    }
  }

  /** Loads a file on the receiver; [done] gets null, or why it failed, on the cast thread. */
  fun load(request: CastRequest, startMs: Long, autoplay: Boolean, speed: Float, done: (String?) -> Unit) {
    val queued = later {
      val r = renderer
      if (r == null || closed) return@later done(NOT_CASTING)
      val failure = try {
        r.load(media(request), startMs, autoplay, speed)
        null
      } catch (e: Exception) {
        message(e)
      }
      done(failure)
    }
    if (!queued) done(NOT_CASTING)
  }

  fun setVolume(level: Float) = run { it.setVolume(level.coerceIn(0f, 1f)) }

  // Callers on the main thread may still reach a link that just closed; never throw at them.
  private fun later(block: () -> Unit): Boolean {
    if (closed) return false
    return try {
      worker.execute(block)
      true
    } catch (e: RejectedExecutionException) {
      false
    }
  }

  /**
   * Keeps the CPU awake while the receiver plays, so the poll that moves to the next part goes
   * on with the screen off. Released on pause, so a speaker left paused costs nothing.
   */
  fun keepAwake(on: Boolean) {
    later {
      if (on && !closed) {
        val lock = wakeLock ?: app.getSystemService(PowerManager::class.java)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lelap:cast")
          .apply { setReferenceCounted(false) }
          .also { wakeLock = it }
        if (!lock.isHeld) lock.acquire()
      } else {
        wakeLock?.let { if (it.isHeld) it.release() }
      }
    }
  }

  /** Stops the receiver and ends the session. Resolves to the last status, if there was one. */
  fun close(error: String? = null): RendererStatus? {
    if (!closing.compareAndSet(false, true)) return lastStatus
    // Closed for callers at once; the shutdown below still runs on the cast thread.
    closed = true
    val last = try {
      worker.submit(Callable { shutDown() }).get(5, TimeUnit.SECONDS)
    } catch (e: Exception) {
      lastStatus
    }
    synchronized(CastLink) { if (current === this) current = null }
    for (listener in listeners) listener.onClosed(error)
    listeners.clear()
    worker.shutdown()
    return last
  }

  /** [close] off the calling thread, for callers on the main thread. */
  fun closeInBackground(error: String? = null) {
    if (closed) return
    Thread({ close(error) }, "lelap-cast-close").start()
  }

  private fun shutDown(): RendererStatus? {
    closed = true
    val last = runCatching { renderer?.status() }.getOrNull() ?: lastStatus
    poll?.cancel(false)
    poll = null
    runCatching { renderer?.close() }
    renderer = null
    server?.stop()
    server = null
    wifiLock?.let { if (it.isHeld) it.release() }
    wifiLock = null
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    lastStatus = last
    return last
  }

  private fun open() {
    // Report only (M69): read with `adb logcat -s LelapCast`.
    if (device.kind == "cast") {
      Thread({ Log.i(TAG, "cast device auth: ${CastAuthProbe.describe(CastAuthProbe.run(device))}") }, "lelap-cast-auth")
        .apply { isDaemon = true }
        .start()
    }
    renderer = when (device.kind) {
      "upnp" -> UpnpRenderer(device)
      "cast" -> GoogleCastRenderer(device, ::lost)
      "fcast" -> FCastRenderer(device, ::lost)
      else -> throw CastException("Unknown kind of receiver")
    }
    val wifi = app.getSystemService(WifiManager::class.java)
    @Suppress("DEPRECATION")
    wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "lelap-cast").apply {
      setReferenceCounted(false)
      acquire()
    }
    poll = worker.scheduleWithFixedDelay({ pollStatus() }, 1, 1, TimeUnit.SECONDS)
  }

  private fun pollStatus() {
    val r = renderer?.takeIf { !closed } ?: return
    val status = try {
      r.status()
    } catch (e: Exception) {
      lastStatus?.copy(error = e.message) ?: return
    }
    lastStatus = status
    for (listener in listeners) listener.onStatus(status)
  }

  /** The receiver closed the connection; whoever plays through the link hands back. */
  private fun lost(message: String) = closeInBackground(message)

  private fun media(request: CastRequest): CastMedia {
    val uri = request.uri
    val local = uri.startsWith("file://") || uri.startsWith("content://")
    val name = Mime.nameFor(if (local) server().displayName(uri) else uri, request.fileName)
    val mimeType = Mime.audioOr(request.mimeType, name)
    val url = when {
      local -> server().publish(MediaServer.Source.Local(uri), mimeType, name)
      request.throughPhone -> server().publish(MediaServer.Source.Remote(uri, request.headers), mimeType, name)
      else -> uri
    }
    val cover = request.coverUri?.let { c ->
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
      title = request.title,
      artist = request.artist,
      album = request.album,
      coverUrl = cover,
      durationMs = request.durationMs,
    )
  }

  private fun server(): MediaServer = server ?: MediaServer(app).also { server = it }

  companion object {
    private const val NOT_CASTING = "Not casting"
    private const val TAG = "LelapCast"

    /** The session running now, if any. */
    @Volatile
    var current: CastLink? = null
      private set

    /** Connects to [device], ending any session before. Blocks on the network; never on main. */
    fun open(context: Context, device: CastDevice): CastLink {
      current?.close()
      val link = CastLink(context, device)
      try {
        link.worker.submit(Callable { link.open() }).get()
      } catch (e: ExecutionException) {
        link.worker.execute { link.shutDown() }
        link.worker.shutdown()
        throw CastException(link.message(e.cause ?: e))
      }
      synchronized(CastLink) { current = link }
      return link
    }
  }

  private fun message(e: Throwable): String =
    if (e is CastException) e.message.orEmpty() else (e.message ?: "Casting failed")
}
