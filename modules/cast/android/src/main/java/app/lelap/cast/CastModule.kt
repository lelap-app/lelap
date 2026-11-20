package app.lelap.cast

import android.content.Context
import android.os.Build
import android.util.Log
import app.lelap.netfs.LocalNetwork
import app.lelap.text.NativeText
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CastFailedException(message: String) : CodedException(message)

/** Android 17 without local network access: JavaScript shows the explanation and asks. */
class LocalNetworkDeniedException : CodedException("ERR_LOCAL_NETWORK", "Local network access is off", null)

/** A Google Cast speaker failed device authentication: JavaScript offers “Connect anyway”. */
class CastUntrustedCodedException(message: String) : CodedException("ERR_CAST_UNTRUSTED", message, null)

/**
 * Bridges JavaScript to discovery and to the [CastLink]. Playback itself goes through the
 * playback service, whose media session plays through the link while casting (M50); this side
 * connects, hands the volume over and reports the receiver's state and the session's end.
 */
class CastModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var discovery: Discovery? = null
  private var watched: CastLink? = null

  private val linkListener = object : CastLink.Listener {
    override fun onStatus(status: RendererStatus) {
      sendEvent(STATUS_EVENT, statusMap(watched?.device?.id, status.state.name.lowercase(), status))
    }

    override fun onClosed(error: String?) {
      val link = watched ?: return
      watched = null
      val state = if (error == null) "closed" else "lost"
      sendEvent(STATUS_EVENT, statusMap(link.device.id, state, link.lastStatus, error))
    }
  }

  private fun discovery(): Discovery = discovery ?: Discovery(
    context,
    hasAccess = ::hasLocalNetwork,
    onReport = { report -> sendEvent(DISCOVERY_EVENT, report) },
    onChange = { list -> sendEvent(DEVICES_EVENT, mapOf("devices" to list.map { it.toMap() })) },
  ).also { discovery = it }

  private fun hasLocalNetwork(): Boolean = LocalNetwork.granted(context)

  private fun watch(link: CastLink?) {
    if (watched === link) return
    watched?.removeListener(linkListener)
    watched = link
    link?.addListener(linkListener)
  }

  override fun definition() = ModuleDefinition {
    Name("LelapCast")
    Events(DEVICES_EVENT, STATUS_EVENT, DISCOVERY_EVENT)

    AsyncFunction("startDiscovery") { discovery().start() }

    AsyncFunction("stopDiscovery") { discovery?.stop() }

    AsyncFunction("devices") { discovery().devices().map { it.toMap() } }

    // Whether the search runs and, when it can't add anything, why (DiscoveryLog.summary).
    AsyncFunction("discoveryReport") { discovery().report() }

    // Discovery's events since the last call, for the diagnostics log: words, kinds, codes, counts.
    AsyncFunction("takeDiagnostics") {
      discovery().log.take().map {
        mapOf("at" to it.at.toDouble(), "what" to it.what, "kind" to it.kind, "code" to it.code, "count" to it.count)
      }
    }

    // "granted", "ask" (with an explanation first) or "blocked" (only Android's settings can).
    AsyncFunction("localNetworkAccess") { promise: Promise -> localNetwork(promise, ask = false) }

    AsyncFunction("requestLocalNetworkAccess") { promise: Promise -> localNetwork(promise, ask = true) }

    // One receiver, or a group of any protocols led by the first (M78). With [anyway], the speaker
    // the last attempt refused connects even though it failed device authentication, for as long
    // as the app runs, and only while it shows the same TLS certificate (M125).
    AsyncFunction("connect") { deviceIds: List<String>, anyway: Boolean ->
      // The receiver and the file server it fetches from are both on the local network.
      if (!hasLocalNetwork()) {
        Log.w(Discovery.TAG, "connect refused: no local network access")
        throw LocalNetworkDeniedException()
      }
      val targets = deviceIds.distinct().map {
        discovery().device(it) ?: throw CastFailedException(NativeText.t(context, "That speaker is no longer on the network"))
      }
      if (targets.isEmpty()) throw CastFailedException(NativeText.t(context, "That speaker is no longer on the network"))
      if (anyway) pinRefused(targets) else refused = null
      val link = try {
        CastLink.open(context, targets, pinned.toSet())
      } catch (e: CastUntrustedException) {
        refuse(e)
      } catch (e: CastException) {
        throw CastFailedException(e.message.orEmpty())
      }
      watch(link)
      mapOf("session" to link.toMap(), "unreached" to link.unreached)
    }

    // A speaker joins the group that plays, or makes one with the receiver that plays (M125). On a
    // thread of its own: it can take half a minute, and every module's async calls share one queue,
    // so the app's own Play and Pause would wait behind it.
    AsyncFunction("join") { deviceId: String, anyway: Boolean, promise: Promise ->
      if (!hasLocalNetwork()) throw LocalNetworkDeniedException()
      val link = CastLink.current?.takeIf { !it.closed } ?: throw CastFailedException(NativeText.t(context, "Not casting"))
      val target = discovery().device(deviceId)
        ?: throw CastFailedException(NativeText.t(context, "That speaker is no longer on the network"))
      if (anyway) pinRefused(listOf(target)) else refused = null
      val pins = pinned.toSet()
      offQueue(promise) {
        try {
          link.join(target, pins)
        } catch (e: CastUntrustedException) {
          refuse(e)
        } catch (e: CastException) {
          throw CastFailedException(e.message.orEmpty())
        }
        if (link.closed) throw CastFailedException(NativeText.t(context, "Not casting"))
        link.toMap()
      }
    }

    // A speaker leaves the group; it stops and the rest play on, the next leading if it led (M139).
    AsyncFunction("leave") { deviceId: String, promise: Promise ->
      val link = CastLink.current?.takeIf { !it.closed } ?: throw CastFailedException(NativeText.t(context, "Not casting"))
      offQueue(promise) {
        try {
          link.leave(deviceId)
        } catch (e: Exception) {
          throw CastFailedException(NativeText.t(context, "Casting failed"))
        }
        link.toMap()
      }
    }

    // The receiver the session plays on, also after the app was closed and opened again.
    AsyncFunction("session") {
      val link = CastLink.current?.takeIf { !it.closed }
      watch(link)
      link?.toMap()
    }

    AsyncFunction("setVolume") { level: Double -> CastLink.current?.setVolume(level.toFloat()) }

    // Ends a session the playback service never took over (it failed before).
    AsyncFunction("disconnect") {
      CastLink.current?.close()
      Unit
    }

    OnDestroy {
      watch(null)
      discovery?.stop()
    }
  }

  private fun localNetwork(promise: Promise, ask: Boolean) {
    if (!LocalNetwork.needed(Build.VERSION.SDK_INT)) return promise.resolve(LocalNetwork.GRANTED)
    val permissions = appContext.permissions ?: return promise.resolve(LocalNetwork.ASK)
    val answer = PermissionsResponseListener { result ->
      val response = result[LocalNetwork.PERMISSION]
      promise.resolve(
        LocalNetwork.access(
          granted = response?.status == PermissionsStatus.GRANTED,
          canAskAgain = response?.canAskAgain ?: true,
        ),
      )
    }
    if (ask) permissions.askForPermissions(answer, LocalNetwork.PERMISSION) else permissions.getPermissions(answer, LocalNetwork.PERMISSION)
  }

  private fun statusMap(deviceId: String?, state: String, status: RendererStatus?, error: String? = status?.error): Map<String, Any?> = mapOf(
    "deviceId" to deviceId,
    "state" to state,
    "positionMs" to (status?.positionMs ?: 0L).toDouble(),
    "durationMs" to (status?.durationMs ?: 0L).toDouble(),
    "volume" to status?.volume?.toDouble(),
    "error" to error,
    // The speakers that play now: one may have dropped out of a group (M125).
    "members" to watched?.members?.map { it.id },
  )

  /** Runs [block] on a thread of its own and settles [promise] with what it returns or throws. */
  private fun offQueue(promise: Promise, block: () -> Any?) {
    Thread({
      try {
        promise.resolve(block())
      } catch (e: CodedException) {
        promise.reject(e)
      } catch (e: Exception) {
        promise.reject(CastFailedException(NativeText.t(context, "Casting failed")))
      }
    }, "lelap-cast-join").start()
  }

  /** “Connect anyway”: pins the certificate the refused speaker showed, if it is one of [targets]. */
  private fun pinRefused(targets: List<CastDevice>) {
    // Only the speaker that was refused, never the others of the attempt.
    refused?.takeIf { r -> targets.any { it.id == r.deviceId } }?.fingerprint?.let { pinned += it }
    refused = null
  }

  private fun refuse(e: CastUntrustedException): Nothing {
    // Without a certificate there is nothing to pin, so “Connect anyway” isn't offered.
    val print = e.fingerprint ?: throw CastFailedException(e.message.orEmpty())
    refused = Refusal(e.device.id, print)
    throw CastUntrustedCodedException(e.message.orEmpty())
  }

  private class Refusal(val deviceId: String, val fingerprint: String?)

  private companion object {
    /**
     * TLS certificate fingerprints of Google Cast speakers the listener let in by hand (M125); kept
     * for the process, never stored. A device id alone could be taken over by another device.
     */
    val pinned: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()

    /** The speaker the last attempt refused, and the certificate it showed, which “Connect anyway” pins. */
    @Volatile
    var refused: Refusal? = null

    const val DEVICES_EVENT = "onDevices"
    const val STATUS_EVENT = "onStatus"
    const val DISCOVERY_EVENT = "onDiscovery"
  }
}
