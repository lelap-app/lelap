package app.lelap.cast

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Finds receivers on the Wi-Fi: UPnP renderers by SSDP, Google Cast and FCast receivers by mDNS
 * (Android's NsdManager). Devices are kept for the session, so a picker opened again is not empty.
 */
class Discovery(private val context: Context, private val onChange: (List<CastDevice>) -> Unit) {
  private val devices = ConcurrentHashMap<String, CastDevice>()
  private val seenLocations = ConcurrentHashMap.newKeySet<String>()
  private val nsd = context.getSystemService(NsdManager::class.java)
  private val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
  private var multicast: WifiManager.MulticastLock? = null
  private var ssdp: ScheduledExecutorService? = null
  private val listeners = mutableListOf<NsdManager.DiscoveryListener>()

  // NsdManager resolves one service at a time before Android 14; queue them.
  private val resolveQueue = ArrayDeque<NsdServiceInfo>()
  private var resolving = false

  fun devices(): List<CastDevice> = devices.values.sortedBy { it.name.lowercase() }

  fun device(id: String): CastDevice? = devices[id]

  @Synchronized
  fun start() {
    if (ssdp != null) return
    multicast = wifi.createMulticastLock("lelap-cast").apply {
      setReferenceCounted(false)
      acquire()
    }
    seenLocations.clear()
    ssdp = Executors.newSingleThreadScheduledExecutor { Thread(it, "lelap-ssdp").apply { isDaemon = true } }.also {
      it.scheduleWithFixedDelay({ runCatching { searchUpnp() } }, 0, 8, TimeUnit.SECONDS)
    }
    discover(GOOGLE_CAST, "cast")
    discover(FCAST, "fcast")
  }

  @Synchronized
  fun stop() {
    ssdp?.shutdownNow()
    ssdp = null
    listeners.forEach { runCatching { nsd.stopServiceDiscovery(it) } }
    listeners.clear()
    synchronized(resolveQueue) {
      resolveQueue.clear()
    }
    multicast?.let { if (it.isHeld) it.release() }
    multicast = null
  }

  private fun publish() = onChange(devices())

  private fun searchUpnp() {
    Ssdp.search(3_000) { answer ->
      if (!seenLocations.add(answer.location)) return@search
      runCatching {
        val response = MiniHttp.request("GET", answer.location)
        val description = Upnp.parseDescription(response.text(), answer.location) ?: return@runCatching
        if (description.avTransportUrl == null) return@runCatching
        val id = description.udn ?: Ssdp.uuidOf(answer.usn) ?: answer.location
        val host = java.net.URI(answer.location).host
        devices[id] = CastDevice(
          id = id,
          name = description.name,
          kind = "upnp",
          host = host,
          port = java.net.URI(answer.location).port,
          model = listOfNotNull(description.manufacturer, description.model).joinToString(" ").ifEmpty { null },
          avTransportUrl = description.avTransportUrl,
          renderingControlUrl = description.renderingControlUrl,
        )
        publish()
      }.onFailure { seenLocations.remove(answer.location) }
    }
  }

  private fun discover(type: String, kind: String) {
    val listener = object : NsdManager.DiscoveryListener {
      override fun onServiceFound(info: NsdServiceInfo) = enqueueResolve(info, kind)

      override fun onServiceLost(info: NsdServiceInfo) {
        if (devices.values.removeIf { it.kind == kind && it.id.endsWith(":${info.serviceName}") }) publish()
      }

      override fun onDiscoveryStarted(serviceType: String) = Unit
      override fun onDiscoveryStopped(serviceType: String) = Unit
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
    }
    runCatching {
      nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
      listeners += listener
    }
  }

  private fun enqueueResolve(info: NsdServiceInfo, kind: String) {
    synchronized(resolveQueue) {
      kinds[info.serviceName] = kind
      resolveQueue.addLast(info)
      if (resolving) return
      resolving = true
    }
    resolveNext()
  }

  private val kinds = ConcurrentHashMap<String, String>()

  @Suppress("DEPRECATION")
  private fun resolveNext() {
    val next = synchronized(resolveQueue) {
      resolveQueue.removeFirstOrNull().also { if (it == null) resolving = false }
    } ?: return
    nsd.resolveService(
      next,
      object : NsdManager.ResolveListener {
        override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) = resolveNext()

        override fun onServiceResolved(info: NsdServiceInfo) {
          runCatching { add(info) }
          resolveNext()
        }
      },
    )
  }

  @Suppress("DEPRECATION")
  private fun add(info: NsdServiceInfo) {
    val host = info.host?.hostAddress ?: return
    val kind = kinds[info.serviceName] ?: return
    val txt = info.attributes.mapValues { (_, v) -> v?.toString(Charsets.UTF_8) }
    val name = when (kind) {
      // Google Cast puts the name people gave the speaker in `fn`, the model in `md`.
      "cast" -> txt["fn"] ?: info.serviceName
      else -> info.serviceName
    }
    val device = CastDevice(
      id = "$kind:${info.serviceName}",
      name = name,
      kind = kind,
      host = host,
      port = info.port,
      model = if (kind == "cast") txt["md"] else "FCast",
    )
    devices[device.id] = device
    publish()
  }

  private companion object {
    const val GOOGLE_CAST = "_googlecast._tcp"
    const val FCAST = "_fcast._tcp"
  }
}
