package app.lelap.cast

import android.content.Context
import android.os.Build
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CastFailedException(message: String) : CodedException(message)

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

  private fun discovery(): Discovery = discovery ?: Discovery(context) { list ->
    sendEvent(DEVICES_EVENT, mapOf("devices" to list.map { it.toMap() }))
  }.also { discovery = it }

  private fun watch(link: CastLink?) {
    if (watched === link) return
    watched?.removeListener(linkListener)
    watched = link
    link?.addListener(linkListener)
  }

  override fun definition() = ModuleDefinition {
    Name("LelapCast")
    Events(DEVICES_EVENT, STATUS_EVENT)

    AsyncFunction("startDiscovery") { discovery().start() }

    AsyncFunction("stopDiscovery") { discovery?.stop() }

    AsyncFunction("devices") { discovery().devices().map { it.toMap() } }

    // "granted", "ask" (with an explanation first) or "blocked" (only Android's settings can).
    AsyncFunction("localNetworkAccess") { promise: Promise -> localNetwork(promise, ask = false) }

    AsyncFunction("requestLocalNetworkAccess") { promise: Promise -> localNetwork(promise, ask = true) }

    AsyncFunction("connect") { deviceId: String ->
      val target = discovery().device(deviceId) ?: throw CastFailedException("That speaker is no longer on the network")
      val link = try {
        CastLink.open(context, target)
      } catch (e: CastException) {
        throw CastFailedException(e.message.orEmpty())
      }
      watch(link)
    }

    // The receiver the session plays on, also after the app was closed and opened again.
    AsyncFunction("session") {
      val link = CastLink.current?.takeIf { !it.closed }
      watch(link)
      link?.device?.toMap()
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
    val target = context.applicationInfo.targetSdkVersion
    if (!LocalNetwork.needed(Build.VERSION.SDK_INT, target)) return promise.resolve(LocalNetwork.GRANTED)
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
  )

  private companion object {
    const val DEVICES_EVENT = "onDevices"
    const val STATUS_EVENT = "onStatus"
  }
}
