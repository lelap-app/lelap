package app.lelap.bluetooth

// android.bluetooth.BluetoothClass constants, copied so the rules run in JVM tests.
private const val MAJOR_AUDIO_VIDEO = 0x0400
private const val CLASS_CAR_AUDIO = 0x0420
private const val CLASS_HANDSFREE = 0x0408

/** A connected Bluetooth audio device as the app sees it. */
data class AudioDevice(
  val id: String,
  val name: String,
  /** Percent, or null when the device reports none. */
  val battery: Int?,
  val car: Boolean,
)

/** The connected audio devices, kept by address. Pure, so the rules are tested on the JVM. */
class AudioDevices {
  private val devices = linkedMapOf<String, AudioDevice>()

  val list: List<AudioDevice>
    get() = devices.values.toList()

  /** A device connected; returns false when it is not an audio device (a watch, a keyboard). */
  fun connect(id: String, name: String?, majorClass: Int?, deviceClass: Int?, battery: Int?): Boolean {
    if (majorClass != null && majorClass != MAJOR_AUDIO_VIDEO) return false
    val known = devices[id]
    devices[id] = AudioDevice(
      id = id,
      name = name?.takeIf { it.isNotBlank() } ?: known?.name ?: "Bluetooth device",
      battery = level(battery) ?: known?.battery,
      car = deviceClass == CLASS_CAR_AUDIO || deviceClass == CLASS_HANDSFREE,
    )
    return known == null || known != devices[id]
  }

  fun disconnect(id: String): Boolean = devices.remove(id) != null

  /** A battery report; only for devices already known as audio devices. */
  fun battery(id: String, level: Int): Boolean {
    val known = devices[id] ?: return false
    val next = known.copy(battery = level(level))
    devices[id] = next
    return next != known
  }

  fun clear() = devices.clear()

  companion object {
    /** Android reports -1 (or nothing) for a device without a level. */
    fun level(raw: Int?): Int? = raw?.takeIf { it in 0..100 }
  }
}
