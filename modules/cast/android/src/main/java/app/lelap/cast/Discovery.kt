package app.lelap.cast

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Finds receivers on the Wi-Fi: UPnP renderers by SSDP, Google Cast and FCast receivers by mDNS
 * (Android's NsdManager). Devices are kept for the session, so a picker opened again is not empty.
 *
 * Every NsdManager callback and call runs on one thread ([worker]), so the mDNS state needs no
 * locks. Each search is a numbered session; callbacks from an earlier one are dropped.
 */
class Discovery(
  private val context: Context,
  private val hasAccess: () -> Boolean,
  private val onReport: (Map<String, Any?>) -> Unit,
  private val onChange: (List<CastDevice>) -> Unit,
) {
  private val devices = ConcurrentHashMap<String, CastDevice>()
  private val seenLocations = ConcurrentHashMap.newKeySet<String>()
  private val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
  private var multicast: WifiManager.MulticastLock? = null
  private var ssdp: ScheduledExecutorService? = null

  // Never shut down: NsdManager may still hand a late callback to it, and a refused task would
  // throw on Android's own thread.
  private val worker = Executors.newSingleThreadScheduledExecutor { Thread(it, "lelap-nsd").apply { isDaemon = true } }

  val log = DiscoveryLog { what, kind, code ->
    Log.i(TAG, "$kind $what${code?.let { " code $it (${nsdError(it)})" } ?: ""}")
  }

  // Worker thread only.
  private var session = 0
  private val listeners = mutableListOf<Pair<NsdManager, NsdManager.DiscoveryListener>>()
  private var manager: NsdManager? = null
  private var managerFailed = false
  private val queue = ResolveQueue<Found>(if (Build.VERSION.SDK_INT >= 34) PARALLEL_RESOLVES else 1)
  private val callbacks = HashMap<String, Pair<NsdManager, Any>>()
  private val timeouts = HashMap<String, ScheduledFuture<*>>()
  private val unaddressed = HashSet<String>()

  private data class Found(val info: NsdServiceInfo, val kind: String, val session: Int) {
    val key get() = ServiceNames.key(kind, info.serviceName)
  }

  fun devices(): List<CastDevice> = devices.values.sortedBy { it.name.lowercase() }

  fun device(id: String): CastDevice? = devices[id]

  fun report(): Map<String, Any?> = log.summary()

  @Synchronized
  fun start() {
    if (ssdp != null) return
    log.begin()
    // Android 17: without local network access every search fails, and an NsdManager made now
    // would stay unusable after the grant. Nothing is touched until access is there.
    if (!hasAccess()) {
      Log.w(TAG, "discovery not started: no local network access")
      listOf(DiscoveryLog.CAST, DiscoveryLog.FCAST, DiscoveryLog.UPNP).forEach {
        log.record(DiscoveryLog.START_FAILED, it, DiscoveryLog.CODE_NO_ACCESS)
      }
      log.end()
      publishReport()
      return
    }
    multicast = wifi.createMulticastLock("lelap-cast").apply {
      setReferenceCounted(false)
      acquire()
    }
    seenLocations.clear()
    ssdp = Executors.newSingleThreadScheduledExecutor { Thread(it, "lelap-ssdp").apply { isDaemon = true } }.also {
      it.scheduleWithFixedDelay(::searchUpnp, 0, 8, TimeUnit.SECONDS)
    }
    worker.execute {
      session++
      discover(GOOGLE_CAST, DiscoveryLog.CAST)
      discover(FCAST, DiscoveryLog.FCAST)
    }
    publishReport()
  }

  @Synchronized
  fun stop() {
    if (ssdp == null) return
    ssdp?.shutdownNow()
    ssdp = null
    worker.execute {
      session++
      listeners.forEach { (manager, listener) ->
        try {
          manager.stopServiceDiscovery(listener)
        } catch (e: RuntimeException) {
          // Not registered: its start failed, which is already in the log.
        }
      }
      listeners.clear()
      queue.clear().forEach(::cancel)
      timeouts.values.forEach { it.cancel(false) }
      timeouts.clear()
      unaddressed.clear()
    }
    multicast?.let { if (it.isHeld) it.release() }
    multicast = null
    log.end()
    publishReport()
  }

  private fun publish() = onChange(devices())

  private fun publishReport() = onReport(log.summary())

  private fun record(what: String, kind: String, code: Int? = null) {
    if (log.record(what, kind, code)) publishReport()
  }

  private fun searchUpnp() {
    try {
      Ssdp.search(3_000) { answer ->
        if (!seenLocations.add(answer.location)) return@search
        record(DiscoveryLog.FOUND, DiscoveryLog.UPNP)
        try {
          val response = MiniHttp.request("GET", answer.location)
          val description = Upnp.parseDescription(response.text(), answer.location) ?: return@search
          if (description.avTransportUrl == null) return@search
          // A URLBase elsewhere would send the phone's commands, and the media's addresses, there.
          val urls = listOf(description.avTransportUrl, description.renderingControlUrl, description.avTransportScpdUrl)
          if (!Ssdp.sameHost(answer.location, urls)) return@search
          val id = description.udn ?: Ssdp.uuidOf(answer.usn) ?: answer.location
          val uri = java.net.URI(answer.location)
          devices[id] = CastDevice(
            id = id,
            name = description.name,
            kind = "upnp",
            host = uri.host,
            port = uri.port,
            model = listOfNotNull(description.manufacturer, description.model).joinToString(" ").ifEmpty { null },
            avTransportUrl = description.avTransportUrl,
            renderingControlUrl = description.renderingControlUrl,
            avTransportScpdUrl = description.avTransportScpdUrl,
          )
          record(DiscoveryLog.ADDED, DiscoveryLog.UPNP)
          publish()
        } catch (e: Exception) {
          seenLocations.remove(answer.location)
          record(DiscoveryLog.RESOLVE_FAILED, DiscoveryLog.UPNP, DiscoveryLog.CODE_THREW)
        }
      }
    } catch (e: Exception) {
      // A failed search would otherwise stop the schedule for good.
      record(DiscoveryLog.START_FAILED, DiscoveryLog.UPNP, DiscoveryLog.CODE_THREW)
    }
  }

  /**
   * Starts one mDNS search. If NsdManager refuses it, or neither starts it nor says why within a
   * few seconds, the search is tried once more on a new NsdManager.
   */
  // Worker thread.
  private fun discover(type: String, kind: String, retry: Boolean = true) {
    val mine = session
    var answered = false
    val again = {
      if (retry && mine == session) {
        Log.i(TAG, "$kind search tried again on a new NsdManager")
        discover(type, kind, retry = false)
      }
    }
    val listener = object : NsdManager.DiscoveryListener {
      override fun onServiceFound(info: NsdServiceInfo) = onWorker(mine) {
        record(DiscoveryLog.FOUND, kind)
        offer(Found(info, kind, mine))
      }

      override fun onServiceLost(info: NsdServiceInfo) = onWorker(mine) {
        record(DiscoveryLog.LOST, kind)
        val key = ServiceNames.key(kind, info.serviceName)
        if (queue.remove(key)) cancel(key)
        if (devices.remove(key) != null) publish()
      }

      override fun onDiscoveryStarted(serviceType: String) = onWorker(mine) {
        answered = true
        record(DiscoveryLog.STARTED, kind)
      }

      override fun onDiscoveryStopped(serviceType: String) = Unit

      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = onWorker(mine) {
        answered = true
        listeners.removeAll { it.second === this }
        managerFailed = true
        record(DiscoveryLog.START_FAILED, kind, errorCode)
        again()
      }

      // Comes after the session ended, so it is recorded whatever the session.
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
        worker.execute { record(DiscoveryLog.STOP_FAILED, kind, errorCode) }
      }
    }
    val nsd = nsd(fresh = !retry)
    try {
      nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
      listeners += nsd to listener
    } catch (e: RuntimeException) {
      Log.w(TAG, "$kind discoverServices threw ${e.javaClass.simpleName}")
      managerFailed = true
      record(DiscoveryLog.START_FAILED, kind, DiscoveryLog.CODE_THREW)
      again()
      return
    }
    worker.schedule({
      if (answered || mine != session) return@schedule
      listeners.removeAll { it.second === listener }
      try {
        nsd.stopServiceDiscovery(listener)
      } catch (e: RuntimeException) {
        // Never registered on NsdManager's side.
      }
      managerFailed = true
      record(DiscoveryLog.START_FAILED, kind, DiscoveryLog.CODE_NO_ANSWER)
      again()
    }, START_TIMEOUT_MS, TimeUnit.MILLISECONDS)
  }

  /**
   * The NsdManager to use, made on first use. One that failed is replaced: on Android 17 a client
   * made before local network access was granted kept doing nothing until the app restarted.
   * `getSystemService` caches per context, so a new one comes from a new context.
   */
  private fun nsd(fresh: Boolean = false): NsdManager {
    val current = manager
    if (current != null && !fresh && !managerFailed) return current
    val made = if (current == null) {
      context.getSystemService(NsdManager::class.java)
    } else {
      Log.i(TAG, "new NsdManager after a failure")
      context.createConfigurationContext(context.resources.configuration).getSystemService(NsdManager::class.java)
    }
    manager = made
    managerFailed = false
    return made
  }

  private fun onWorker(mine: Int, block: () -> Unit) {
    worker.execute { if (mine == session) block() }
  }

  // Worker thread.
  private fun offer(found: Found) {
    queue.offer(found.key, found).forEach(::resolve)
  }

  // Worker thread.
  private fun resolve(start: ResolveQueue.Start<Found>) {
    timeouts[start.key] = worker.schedule({ timedOut(start) }, RESOLVE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    try {
      if (Build.VERSION.SDK_INT >= 34) watch(start) else resolveOnce(start)
    } catch (e: RuntimeException) {
      Log.w(TAG, "${start.item.kind} resolve threw ${e.javaClass.simpleName}")
      fail(start, DiscoveryLog.RESOLVE_FAILED, DiscoveryLog.CODE_THREW)
    }
  }

  /**
   * Android 14 and later: a service info callback, which resolves several services at once and
   * gives up with an error code instead of waiting for ever. It ends once a usable address came.
   */
  @RequiresApi(34)
  private fun watch(start: ResolveQueue.Start<Found>) {
    val callback = object : NsdManager.ServiceInfoCallback {
      override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
        if (queue.isCurrent(start.key, start.token)) callbacks.remove(start.key)
        fail(start, DiscoveryLog.RESOLVE_FAILED, errorCode)
      }

      override fun onServiceUpdated(info: NsdServiceInfo) {
        if (!queue.isCurrent(start.key, start.token)) return
        val host = Addresses.pick(info.hostAddresses)
        // Addresses can come in a later update; the timeout records it if none does.
        if (host == null) unaddressed += start.key else succeed(start, info, host)
      }

      override fun onServiceLost() = Unit

      override fun onServiceInfoCallbackUnregistered() = Unit
    }
    val nsd = nsd()
    callbacks[start.key] = nsd to callback
    nsd.registerServiceInfoCallback(start.item.info, worker, callback)
  }

  /** Before Android 14: one `resolveService` at a time, as the old mDNS daemon allows. */
  @Suppress("DEPRECATION")
  private fun resolveOnce(start: ResolveQueue.Start<Found>) {
    nsd().resolveService(
      start.item.info,
      object : NsdManager.ResolveListener {
        override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
          worker.execute { fail(start, DiscoveryLog.RESOLVE_FAILED, errorCode) }
        }

        override fun onServiceResolved(info: NsdServiceInfo) {
          worker.execute {
            if (!queue.isCurrent(start.key, start.token)) return@execute
            val host = Addresses.pick(listOf(info.host))
            if (host == null) fail(start, DiscoveryLog.NO_ADDRESS) else succeed(start, info, host)
          }
        }
      },
    )
  }

  private fun timedOut(start: ResolveQueue.Start<Found>) {
    if (!queue.isCurrent(start.key, start.token)) return
    val what = if (start.key in unaddressed) DiscoveryLog.NO_ADDRESS else DiscoveryLog.RESOLVE_TIMEOUT
    fail(start, what)
  }

  private fun fail(start: ResolveQueue.Start<Found>, what: String, code: Int? = null) {
    if (!queue.isCurrent(start.key, start.token)) return
    record(what, start.item.kind, code)
    finish(start)
  }

  private fun succeed(start: ResolveQueue.Start<Found>, info: NsdServiceInfo, host: String) {
    val found = start.item
    val txt = info.attributes.mapValues { (_, v) -> v?.toString(Charsets.UTF_8) }
    devices[found.key] = CastDevice(
      id = found.key,
      // The name it was found with: the key stays the same as onServiceLost's.
      name = ServiceNames.display(found.kind, found.info.serviceName, txt),
      kind = found.kind,
      host = host,
      port = info.port,
      // Google Cast puts the model in `md`.
      model = if (found.kind == DiscoveryLog.CAST) txt["md"] else "FCast",
    )
    record(DiscoveryLog.ADDED, found.kind)
    publish()
    finish(start)
  }

  private fun finish(start: ResolveQueue.Start<Found>) {
    val (ended, next) = queue.finish(start.key, start.token)
    if (!ended) return
    cancel(start.key)
    next.forEach(::resolve)
  }

  /** Stops resolving [key]: its timeout and, on Android 14 and later, its callback. */
  private fun cancel(key: String) {
    timeouts.remove(key)?.cancel(false)
    unaddressed.remove(key)
    val (nsd, callback) = callbacks.remove(key) ?: return
    if (Build.VERSION.SDK_INT >= 34) {
      try {
        nsd.unregisterServiceInfoCallback(callback as NsdManager.ServiceInfoCallback)
      } catch (e: RuntimeException) {
        // Already gone, for example after its registration failed.
      }
    }
  }

  companion object {
    const val TAG = "LelapCast"
    private const val GOOGLE_CAST = "_googlecast._tcp"
    private const val FCAST = "_fcast._tcp"

    // Below NsdManager's limit on one app's outstanding requests, with the two searches.
    private const val PARALLEL_RESOLVES = 4
    private const val RESOLVE_TIMEOUT_MS = 10_000L
    private const val START_TIMEOUT_MS = 5_000L

    /** NsdManager's `FAILURE_*` names, for logcat. */
    fun nsdError(code: Int): String = when (code) {
      DiscoveryLog.CODE_THREW -> "threw"
      DiscoveryLog.CODE_NO_ANSWER -> "no answer"
      0 -> "FAILURE_INTERNAL_ERROR"
      3 -> "FAILURE_ALREADY_ACTIVE"
      4 -> "FAILURE_MAX_LIMIT"
      5 -> "FAILURE_OPERATION_NOT_RUNNING"
      6 -> "FAILURE_BAD_PARAMETERS"
      7 -> "FAILURE_PERMISSION_DENIED"
      else -> "unknown"
    }
  }
}
