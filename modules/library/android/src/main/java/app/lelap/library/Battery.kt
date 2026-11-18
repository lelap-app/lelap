package app.lelap.library

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build

/**
 * Whether the battery is low, checked by the chapter scan itself (M85). WorkManager's battery
 * constraint lets Android hold a job back under flexible scheduling, which kept a scan the
 * listener asked for waiting at 84 %.
 */
object Battery {
  /** Android's usual low-battery warning level, for when the system does not say. */
  const val LOW_PERCENT = 15

  /** Never low while charging; otherwise as the system says, or at [LOW_PERCENT] or less. */
  fun isLow(percent: Int?, charging: Boolean, systemLow: Boolean?): Boolean {
    if (charging) return false
    if (systemLow != null) return systemLow
    return percent != null && percent <= LOW_PERCENT
  }

  fun isLow(context: Context): Boolean {
    // A sticky broadcast: reading it registers nothing.
    val status = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return false
    val level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    val percent = if (level >= 0 && scale > 0) level * 100 / scale else null
    val charging = status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
    val systemLow =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && status.hasExtra(BatteryManager.EXTRA_BATTERY_LOW)) {
        status.getBooleanExtra(BatteryManager.EXTRA_BATTERY_LOW, false)
      } else {
        null
      }
    return isLow(percent, charging, systemLow)
  }
}
