package app.lelap.bluetooth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CHANGE_EVENT = "onChange"

// Public broadcast names that the SDK keeps hidden; Android sends them to apps that may connect.
private const val ACTION_BATTERY_LEVEL_CHANGED = "android.bluetooth.device.action.BATTERY_LEVEL_CHANGED"
private const val EXTRA_BATTERY_LEVEL = "android.bluetooth.device.extra.BATTERY_LEVEL"

/**
 * Connected Bluetooth audio devices with their battery level and whether they are a car. Only
 * runs between [start] and [stop], and only with the nearby devices permission the app asks for
 * when the listener turns a feature on. No scanning, no location.
 */
class BluetoothModule : Module() {
  private val devices = AudioDevices()
  private var receiver: BroadcastReceiver? = null

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LelapBluetooth")
    Events(CHANGE_EVENT)

    Function("permitted") { permitted() }

    AsyncFunction("start") { start() }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { stop() }.runOnQueue(Queues.MAIN)

    Function("devices") { devices.list.map(::toMap) }

    OnDestroy { stop(quietly = true) }
  }

  private fun permitted(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

  @SuppressLint("MissingPermission")
  private fun start(): Boolean {
    if (receiver != null) return true
    if (!permitted()) return false
    val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter ?: return false
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) = onBroadcast(intent)
    }
    val filter = IntentFilter().apply {
      addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
      addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
      addAction(ACTION_BATTERY_LEVEL_CHANGED)
    }
    // System broadcasts reach a receiver that is not exported.
    ContextCompat.registerReceiver(context, r, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    receiver = r
    // What is connected already: the broadcasts only tell what changes from now on.
    for (profile in listOf(BluetoothProfile.A2DP, BluetoothProfile.HEADSET)) {
      try {
        adapter.getProfileProxy(
          context,
          object : BluetoothProfile.ServiceListener {
            override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
              try {
                if (receiver != null) proxy.connectedDevices.forEach { add(it, null) }
              } catch (e: SecurityException) {
                // The permission was taken back meanwhile.
              } finally {
                adapter.closeProfileProxy(profile, proxy)
              }
            }

            override fun onServiceDisconnected(profile: Int) = Unit
          },
          profile,
        )
      } catch (e: SecurityException) {
        return false
      }
    }
    return true
  }

  private fun stop(quietly: Boolean = false) {
    receiver?.let {
      try {
        appContext.reactContext?.applicationContext?.unregisterReceiver(it)
      } catch (e: Exception) {
        // Already gone with the context.
      }
    }
    receiver = null
    if (quietly) {
      devices.clear()
    } else if (devices.list.isNotEmpty()) {
      devices.clear()
      emit()
    }
  }

  private fun onBroadcast(intent: Intent) {
    val device = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java) ?: return
    try {
      when (intent.action) {
        BluetoothDevice.ACTION_ACL_CONNECTED -> add(device, null)
        BluetoothDevice.ACTION_ACL_DISCONNECTED -> if (devices.disconnect(device.address)) emit()
        ACTION_BATTERY_LEVEL_CHANGED -> {
          val level = intent.getIntExtra(EXTRA_BATTERY_LEVEL, -1)
          if (!devices.battery(device.address, level)) add(device, level)
          else emit()
        }
      }
    } catch (e: SecurityException) {
      // The permission was taken back while running.
    }
  }

  @SuppressLint("MissingPermission")
  private fun add(device: BluetoothDevice, level: Int?) {
    val cls = device.bluetoothClass
    if (devices.connect(device.address, device.name, cls?.majorDeviceClass, cls?.deviceClass, level ?: batteryOf(device))) emit()
  }

  // The level the system already knows, for devices that connected before [start]. The getter is
  // hidden in the SDK; without it the level shows with the device's next report.
  private fun batteryOf(device: BluetoothDevice): Int? = try {
    device.javaClass.getMethod("getBatteryLevel").invoke(device) as? Int
  } catch (e: Throwable) {
    null
  }

  private fun emit() = sendEvent(CHANGE_EVENT, mapOf("devices" to devices.list.map(::toMap)))

  private fun toMap(d: AudioDevice): Map<String, Any?> =
    mapOf("id" to d.id, "name" to d.name, "battery" to d.battery, "car" to d.car)
}
