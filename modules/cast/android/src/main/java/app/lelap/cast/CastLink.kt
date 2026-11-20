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
import java.util.concurrent.TimeoutException
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
  /** The part as the phone renders it with its sound effects (M134), instead of the file. */
  val live: LiveAudio? = null,
  /** A live stream (M154), such as a radio station: the receiver plays it as live, if it can. */
  val onAir: Boolean = false,
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
  first: CastDevice,
  speakers: List<CastDevice>,
) {
  /**
   * The receiver, or for a group a stand-in named after its speakers (kind `group`). Its id stays
   * the same while speakers join and leave (M125), so JavaScript follows one session.
   */
  @Volatile
  var device: CastDevice = first
    private set

  /** The speakers, the first leading; one for a single receiver. */
  @Volatile
  var members: List<CastDevice> = speakers
    private set

  interface Listener {
    fun onStatus(status: RendererStatus)

    /** The session is over: handed back ([error] null) or lost. */
    fun onClosed(error: String?)

    /**
     * A speaker joined while the phone renders the part (M134) and [joinStream] gave it no stream
     * of its own: a rendered stream can't be joined halfway, so the whole group starts it again
     * from the place.
     */
    fun onRestartNeeded() = Unit

    /**
     * A speaker joins while the phone renders the part (M150): the part rendered for it alone,
     * from the leader's place [leadMs] from now, or null. Called on the cast thread.
     */
    fun joinStream(leadMs: Long): CastRequest? = null
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

  /** For JavaScript: the receiver, and for a group its speakers. */
  fun toMap(): Map<String, Any?> = device.toMap() + ("members" to members.map { it.toMap() })

  // The leader as the session plays it: remembers the file and speed, for a speaker that joins.
  private var leader: RememberingRenderer? = null

  // Its own client, which a lost-connection callback names; changed on the cast thread.
  @Volatile
  private var leaderClient: Renderer? = null

  // Guarded by the cast thread: the group, once there is one, and each follower's client by id.
  @Volatile
  private var group: GroupRenderer? = null
  private val followers = mutableMapOf<String, Renderer>()

  private fun probe(member: CastDevice): FutureTask<CastAuthProbe.Outcome>? =
    if (member.kind != "cast") null
    else FutureTask { CastAuthProbe.run(member) }.also { Thread(it, "lelap-cast-auth").apply { isDaemon = true }.start() }

  /**
   * Enforced (M78): a Google Cast speaker that doesn't prove itself is not connected, unless the
   * listener chose “Connect anyway” for the TLS certificate its session's connection shows
   * (M125). The verdict must come from that same certificate too.
   */
  private fun checkTrust(member: CastDevice, probe: FutureTask<CastAuthProbe.Outcome>, session: Renderer, pinned: Set<String>) {
    val outcome = try {
      probe.get(AUTH_WAIT_MS, TimeUnit.MILLISECONDS)
    } catch (e: Exception) {
      CastAuthProbe.Outcome(CastAuth.Verdict.Untrusted("no answer"), null)
    }
    val certificate = (session as? GoogleCastRenderer)?.peerCertificate
    val verdict = CastAuthProbe.forSession(outcome, certificate)
    val allowed = CastAuthProbe.letIn(verdict, certificate, pinned)
    Log.i(TAG, "cast device auth: ${CastAuthProbe.describe(verdict)}${if (verdict is CastAuth.Verdict.Untrusted && allowed) ", connected anyway" else ""}")
    if (!allowed) throw CastUntrustedException(member, CastAuthProbe.fingerprint(certificate))
  }

  private fun follower(member: CastDevice): Renderer {
    var self: Renderer? = null
    // A follower lost before the group exists is dropped by its first failed command.
    return rendererFor(member) { message -> self?.let { r -> lostSpeaker(r, message) } }.also { self = it }
  }

  private fun open(pinned: Set<String>) {
    // Device authentication on connections of their own, alongside the session's (M69). Read
    // the verdicts with `adb logcat -s LelapCast`.
    val probes = members.mapNotNull { member -> probe(member)?.let { member to it } }
    val opened = mutableMapOf<String, Renderer>()
    var self: Renderer? = null
    val first = rendererFor(members.first()) { message -> lostSpeaker(self, message) }.also {
      self = it
      opened[members.first().id] = it
    }
    val remembering = RememberingRenderer(first)
    leader = remembering
    leaderClient = first
    renderer = remembering
    if (members.size > 1) {
      val missed = mutableListOf<CastDevice>()
      for (member in members.drop(1)) {
        try {
          opened[member.id] = follower(member)
        } catch (e: Exception) {
          missed += member
        }
      }
      if (missed.isNotEmpty()) Log.i(TAG, "group: ${missed.size} of ${members.size} speakers not reached")
      followers += opened - members.first().id
      group = groupOf(remembering, followers.values.toList()).also { renderer = it }
      unreached = missed.map { it.name }
      members = members - missed.toSet()
      device = standIn(members).copy(id = device.id)
    }
    // One the group couldn't reach plays no part.
    for ((member, probe) in probes) {
      val session = opened[member.id] ?: continue
      checkTrust(member, probe, session, pinned)
    }
    val wifi = app.getSystemService(WifiManager::class.java)
    @Suppress("DEPRECATION")
    wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "lelap-cast").apply {
      setReferenceCounted(false)
      acquire()
    }
    poll = worker.scheduleWithFixedDelay({ pollStatus() }, 1, 1, TimeUnit.SECONDS)
  }

  /**
   * Adds [member] to the speakers that play (M125): a single receiver becomes a group it leads.
   * The new speaker loads the file at the leader's place, and the group's sync brings it in step.
   * Blocks on the network for up to about half a minute; never on main, never on the cast thread.
   */
  fun join(member: CastDevice, pinned: Set<String>) {
    if (closed) throw CastException(NativeText.current().t("Not casting"))
    if (members.any { it.id == member.id }) return
    val probe = probe(member)
    // Set when the speaker was lost, or the wait gave up, before the cast thread added it.
    val gone = AtomicBoolean(false)
    var joining: Renderer? = null
    val loaded = try {
      val r = rendererFor(member) { message ->
        gone.set(true)
        joining?.let { j -> lostSpeaker(j, message) }
      }
      joining = r
      if (probe != null) checkTrust(member, probe, r, pinned)
      val task = worker.submit(Callable { addFollower(member, r, gone) })
      try {
        task.get(JOIN_WAIT_S, TimeUnit.SECONDS)
      } catch (e: TimeoutException) {
        gone.set(true)
        task.cancel(false)
        throw e
      }
    } catch (e: Exception) {
      gone.set(true)
      joining?.let { r ->
        runCatching { r.close() }
        // In case the cast thread added it just as the wait gave up.
        later { removeRenderer(r) }
      }
      throw unwrap(e)
    }
    try {
      loaded?.get(GroupRenderer.COMMAND_WAIT_S, TimeUnit.SECONDS)
    } catch (e: Exception) {
      joining?.let { r -> later { removeRenderer(r) } }
      throw CastException(NativeText.current().t("{name} couldn’t join", "name" to member.name))
    }
  }

  /**
   * The sleep timer's fade times the bedtime volume, as far as the receiver was lowered by it
   * (M125); a speaker that joins meanwhile is lowered as much, one that is taken out gets its
   * volume back first.
   */
  fun setFadeScale(scale: Float) {
    if (scale == fadeScale) return
    fadeScale = scale
    later { group?.scale = scale }
  }

  @Volatile
  private var fadeScale = 1f

  /**
   * Takes a speaker out of the group; it stops and the rest play on. When it is the leading one,
   * the speaker that joined first after it leads from here (M139). The last one can't leave.
   */
  fun leave(memberId: String) {
    if (closed) return
    // Decided on the cast thread: a hand-over just before (a double tap, a lost leader) changed who leads.
    worker.submit(
      Callable {
        when {
          members.size < 2 -> Unit
          members.firstOrNull()?.id == memberId -> {
            handOver()
          }
          else -> removeFollower(memberId)
        }
      },
    ).get(JOIN_WAIT_S, TimeUnit.SECONDS)
  }

  /**
   * A speaker's client lost its connection (any thread). A follower leaves the group; the leader
   * hands over to the next speaker, and ends the session only when it played alone.
   */
  private fun lostSpeaker(client: Renderer?, message: String) {
    client ?: return
    // Alone, the session ends at once, as before: the cast thread may be stuck on that speaker.
    // In a group (even one handing over right now) the cast thread decides, in order.
    if (client === leaderClient && group == null) return lost(message)
    val queued = later {
      when {
        client !== leaderClient -> group?.drop(client)
        // No one ready to lead (all still joining): the session ends as it would alone.
        !handOver() -> lost(message)
      }
    }
    if (!queued && client === leaderClient) lost(message)
  }

  // On the cast thread: the next speaker leads, with the file and speed the leader had. False
  // when no speaker is ready to.
  private fun handOver(): Boolean {
    val g = group ?: return false
    val old = leader ?: return false
    val next = g.handOver { client -> RememberingRenderer(client, old.media, old.speed).also { leader = it } } ?: return false
    leaderClient = next
    val id = followers.entries.firstOrNull { it.value === next }?.key
    if (id != null) followers.remove(id)
    val promoted = members.firstOrNull { it.id == id }
    members = listOfNotNull(promoted) + members.drop(1).filter { it.id != id }
    device = standIn(members).copy(id = device.id)
    // A speaker that joined a rendered part plays a stream of its own (M150), whose places the
    // phone's clock doesn't know: the group starts the part again together.
    if (old.media?.live == true) for (listener in listeners) listener.onRestartNeeded()
    return true
  }

  // On the cast thread. The future is the new speaker's catch-up load, null when nothing plays.
  private fun addFollower(member: CastDevice, joining: Renderer, gone: AtomicBoolean): java.util.concurrent.Future<Unit>? {
    if (closed) throw CastException(NativeText.current().t("Not casting"))
    if (gone.get()) throw CastException(NativeText.current().t("{name} couldn’t join", "name" to member.name))
    val first = leader ?: throw CastException(NativeText.current().t("Not casting"))
    val media = first.media
    if (media != null && !joining.canPlayAt(first.speed)) {
      throw CastException(NativeText.current().t("{name} only plays at 1×. Set the speed to 1× to add it.", "name" to member.name))
    }
    val g = group ?: groupOf(first, emptyList()).also {
      group = it
      renderer = it
    }
    val status = lastStatus
    val playing = status?.state == PlayState.PLAYING || status?.state == PlayState.BUFFERING
    val stopped = media == null || status == null || status.state == PlayState.IDLE || status.state == PlayState.ENDED
    // A rendered stream starts where the phone began it: the newcomer gets one of its own from the
    // leader's place (M150), else the group loads it again together.
    val own = if (media?.live == true && !stopped) joinStream(0L) else null
    val restart = media?.live == true && own == null
    val catchUp: ((Renderer) -> Unit)? = when {
      own != null -> { r -> catchUpLive(r, own, playing) }
      restart || stopped -> null
      else -> {
        val speed = first.speed
        { r -> r.load(media!!, status!!.positionMs, playing, speed) }
      }
    }
    val loaded = g.add(joining, catchUp)
    followers[member.id] = joining
    members = members + member
    device = standIn(members).copy(id = device.id)
    Log.i(TAG, "group: a speaker joined, ${members.size} play")
    if (restart && !playingNone(status)) for (listener in listeners) listener.onRestartNeeded()
    return loaded
  }

  private fun joinStream(leadMs: Long): CastRequest? =
    listeners.firstNotNullOfOrNull { runCatching { it.joinStream(leadMs) }.getOrNull() }

  /**
   * Loads a newcomer's own rendered stream, on its thread; one that took long to load gets a
   * second stream that much further ahead, so it lands near the others ([LiveJoin]).
   */
  private fun catchUpLive(r: Renderer, request: CastRequest, playing: Boolean) {
    val live = request.live ?: return
    val started = android.os.SystemClock.elapsedRealtime()
    val first = liveMedia(request, live, alongside = true)
    r.load(first, 0L, playing, 1f)
    val took = android.os.SystemClock.elapsedRealtime() - started
    val lead = if (playing) LiveJoin.secondLead(took) else null
    Log.i(TAG, "group: a speaker joined a rendered stream, loaded in $took ms")
    val again = lead?.let { joinStream(it) }?.live ?: return
    r.load(liveMedia(request, again, alongside = true), 0L, playing, 1f)
    // Its first stream renders for no one now.
    server().withdraw(first.url)
  }

  private fun playingNone(status: RendererStatus?) =
    status == null || status.state == PlayState.IDLE || status.state == PlayState.ENDED

  private fun groupOf(first: Renderer, rest: List<Renderer>) = GroupRenderer(
    first,
    rest,
    clock = { System.nanoTime() / 1_000_000L },
    // A speaker that dropped out is no longer listed as playing.
    onLeft = { gone -> later { removeRenderer(gone) } },
  ).also { it.scale = fadeScale }

  // On the cast thread.
  private fun removeRenderer(r: Renderer) {
    followers.entries.firstOrNull { it.value === r }?.key?.let(::removeFollower)
  }

  // On the cast thread.
  private fun removeFollower(memberId: String) {
    val r = followers.remove(memberId) ?: return
    group?.remove(r)
    members = members.filter { it.id != memberId }
    device = standIn(members).copy(id = device.id)
  }

  private fun unwrap(e: Exception): Exception {
    val cause = if (e is ExecutionException) e.cause ?: e else e
    return when (cause) {
      is CastException -> cause
      else -> CastException(message(cause))
    }
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
    else -> throw CastException(NativeText.current().t("Lelap can’t cast to this kind of speaker."))
  }

  /** The receiver closed the connection; whoever plays through the link hands back. */
  private fun lost(message: String) = closeInBackground(message)

  private fun media(request: CastRequest): CastMedia {
    request.live?.let { return liveMedia(request, it) }
    val uri = request.uri
    val local = uri.startsWith("file://") || uri.startsWith("content://")
    val name = Mime.nameFor(if (local) server().displayName(uri) else uri, request.fileName)
    val mimeType = Mime.audioOr(request.mimeType, name)
    val url = when {
      local -> server().publish(MediaServer.Source.Local(uri), mimeType, name)
      request.throughPhone -> server().publish(MediaServer.Source.Remote(uri, request.headers), mimeType, name)
      else -> uri
    }
    return CastMedia(
      url = url,
      mimeType = mimeType,
      title = request.title,
      artist = request.artist,
      album = request.album,
      coverUrl = cover(request),
      durationMs = request.durationMs,
      onAir = request.onAir,
    )
  }

  private fun liveMedia(request: CastRequest, live: LiveAudio, alongside: Boolean = false): CastMedia = CastMedia(
    url = server().publish(MediaServer.Source.Live(live), live.mimeType, "part.${live.extension}", alongside),
    mimeType = live.mimeType,
    title = request.title,
    artist = request.artist,
    album = request.album,
    coverUrl = cover(request),
    // With skip silence and speed, the stream is shorter than the file, by an amount not known yet.
    durationMs = 0L,
    live = true,
    onAir = request.onAir,
  )

  private fun cover(request: CastRequest): String? = request.coverUri?.let { c ->
    when {
      c.startsWith("file://") || c.startsWith("content://") -> {
        val coverName = server().displayName(c)
        server().publish(MediaServer.Source.Local(c), Mime.image(coverName), coverName)
      }
      c.startsWith("http://") || c.startsWith("https://") -> c
      else -> null
    }
  }

  private fun server(): MediaServer = server ?: MediaServer(app).also { server = it }

  companion object {
    private const val TAG = "LelapCast"

    /** A little longer than the probe can take, so a slow but genuine speaker isn't cut off. */
    private const val AUTH_WAIT_MS = CastAuthProbe.LONGEST_MS + 3_000L

    /** The session running now, if any. */
    @Volatile
    var current: CastLink? = null
      private set

    /** How long [join] and [leave] wait for the cast thread, which a slow command may hold. */
    private const val JOIN_WAIT_S = 30L

    /**
     * Connects to [devices], one receiver or a group led by the first, ending any session before.
     * A Google Cast speaker whose TLS certificate's fingerprint is in [pinned] connects even when
     * it fails device authentication. Blocks on the network; never on main.
     */
    fun open(context: Context, devices: List<CastDevice>, pinned: Set<String> = emptySet()): CastLink {
      require(devices.isNotEmpty())
      current?.close()
      // Loads the profile's lines for the receivers' threads, which have no Context.
      NativeText.get(context)
      val link = CastLink(context, standIn(devices), devices)
      try {
        link.worker.submit(Callable { link.open(pinned) }).get()
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
