package app.lelap.cast

import android.content.Context
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.util.Log
import app.lelap.text.NativeText
import app.lelap.text.Reasons
import java.util.concurrent.Callable
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
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
  /** The receiver, or for a group a stand-in named after its speakers (kind `group`). */
  val device: CastDevice,
  /** The speakers, the first leading; one for a single receiver. */
  val members: List<CastDevice>,
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
      if (r == null || closed) return@later done(NativeText.current().t("Not casting"))
      val started = System.nanoTime()
      val failure = try {
        r.load(media(request), startMs, autoplay, speed)
        null
      } catch (e: Exception) {
        message(e)
      }
      // Logged here as well as by the player's RemoteSession, which logged none on beta 7 (M69):
      // this line shows whether a load reached the receiver at all.
      Log.i(TAG, "${device.kind} load-call ${(System.nanoTime() - started) / 1_000_000L} ms${if (failure == null) "" else ", failed"}")
      done(failure)
    }
    if (!queued) done(NativeText.current().t("Not casting"))
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

  /** Speakers of the group that could not be reached when it connected; it plays without them. */
  var unreached: List<String> = emptyList()
    private set
  private var skipped: Set<String> = emptySet()

  /** For JavaScript: the receiver, and for a group its speakers. */
  fun toMap(): Map<String, Any?> = device.toMap() + ("members" to members.map { it.toMap() })

  private fun open(trusted: Set<String>) {
    // Device authentication on connections of their own, alongside the session's (M69). Read
    // the verdicts with `adb logcat -s LelapCast`.
    val probes = members.filter { it.kind == "cast" }.map { member ->
      member to FutureTask { CastAuthProbe.run(member) }.also { Thread(it, "lelap-cast-auth").apply { isDaemon = true }.start() }
    }
    val leader = rendererFor(members.first(), ::lost)
    renderer = leader
    if (members.size > 1) {
      // Set once the group exists; a follower lost before that is dropped by its first failed command.
      var group: GroupRenderer? = null
      val followers = mutableListOf<Renderer>()
      val missed = mutableListOf<CastDevice>()
      for (member in members.drop(1)) {
        try {
          var self: Renderer? = null
          rendererFor(member) { self?.let { r -> group?.drop(r) } }.also { self = it; followers += it }
        } catch (e: Exception) {
          missed += member
        }
      }
      if (missed.isNotEmpty()) Log.i(TAG, "group: ${missed.size} of ${members.size} speakers not reached")
      group = GroupRenderer(leader, followers, clock = { System.nanoTime() / 1_000_000L })
      renderer = group
      unreached = missed.map { it.name }
      skipped = missed.map { it.id }.toSet()
    }
    // Enforced (M78): a Google Cast speaker that doesn't prove itself is not connected, unless
    // the listener chose “Connect anyway” for it. One the group couldn't reach plays no part.
    for ((member, probe) in probes) {
      if (member.id in skipped) continue
      val verdict = try {
        probe.get(AUTH_WAIT_S, TimeUnit.SECONDS)
      } catch (e: Exception) {
        CastAuth.Verdict.Untrusted("no answer")
      }
      val allowed = member.id in trusted
      Log.i(TAG, "cast device auth: ${CastAuthProbe.describe(verdict)}${if (verdict is CastAuth.Verdict.Untrusted && allowed) ", connected anyway" else ""}")
      if (verdict is CastAuth.Verdict.Untrusted && !allowed) throw CastUntrustedException(member)
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
      lastStatus?.copy(error = message(e)) ?: return
    }
    lastStatus = status
    for (listener in listeners) listener.onStatus(status)
  }

  private fun rendererFor(member: CastDevice, onLost: (String) -> Unit): Renderer = when (member.kind) {
    "upnp" -> UpnpRenderer(member)
    "cast" -> GoogleCastRenderer(member, onLost)
    "fcast" -> FCastRenderer(member, onLost)
    else -> throw CastException("Unknown kind of receiver")
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
    private const val TAG = "LelapCast"

    /** The probe itself gives up after 5 s without an answer. */
    private const val AUTH_WAIT_S = 12L

    /** The session running now, if any. */
    @Volatile
    var current: CastLink? = null
      private set

    /**
     * Connects to [devices], one receiver or a group led by the first, ending any session before.
     * Google Cast speakers in [trusted] connect even when they fail device authentication.
     * Blocks on the network; never on main.
     */
    fun open(context: Context, devices: List<CastDevice>, trusted: Set<String> = emptySet()): CastLink {
      require(devices.isNotEmpty())
      current?.close()
      // Loads the profile's lines for the receivers' threads, which have no Context.
      NativeText.get(context)
      val link = CastLink(context, standIn(devices), devices)
      try {
        link.worker.submit(Callable { link.open(trusted) }).get()
      } catch (e: ExecutionException) {
        link.worker.execute { link.shutDown() }
        link.worker.shutdown()
        val cause = e.cause
        if (cause is CastUntrustedException) throw cause
        throw CastException(link.message(cause ?: e))
      }
      synchronized(CastLink) { current = link }
      return link
    }

    /** The receiver itself, or for a group one named after its speakers. */
    fun standIn(devices: List<CastDevice>): CastDevice {
      val first = devices.first()
      if (devices.size == 1) return first
      return CastDevice(
        id = groupId(devices.map { it.id }),
        name = devices.joinToString(" + ") { it.name },
        kind = "group",
        host = first.host,
        port = first.port,
      )
    }

    fun groupId(ids: List<String>): String = "group:" + ids.joinToString("+")
  }

  // Android's own messages follow the phone's language, so only a known kind of failure is named.
  private fun message(e: Throwable): String =
    if (e is CastException) e.message.orEmpty()
    else Reasons.of(e, NativeText.current()) ?: NativeText.current().t("Casting failed")
}
