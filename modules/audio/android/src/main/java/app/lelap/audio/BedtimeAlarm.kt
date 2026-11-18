package app.lelap.audio

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import java.util.TimeZone

/**
 * Wakes the playback service when the bedtime window opens (M86), so a book that is already
 * playing gets the routine's timer and volume without a press of Play.
 *
 * An inexact alarm that may fire in Doze (`setAndAllowWhileIdle`): it needs no permission, where
 * exact alarms need “Alarms and reminders” on Android 12 and later. A few minutes late is fine for
 * bedtime. The broadcast only reaches a running service; with nothing playing there is nothing to
 * do, and the next Play inside the window starts the routine itself. The service and the app set
 * the alarm again whenever they start, so a reboot loses nothing that matters.
 */
object BedtimeAlarm {
  /** Sets the alarm for the next start of the window the app last handed over, or clears it. */
  fun schedule(context: Context) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val prefs = context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE)
    val bedtime = Bedtime.decode(prefs.getString(Commands.PREF_BEDTIME, null))
    val zone = TimeZone.getDefault()
    val at = Bedtime.nextStartMs(bedtime, System.currentTimeMillis()) { zone.getOffset(it) }
    val intent = pendingIntent(context)
    if (at == null) alarms.cancel(intent) else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
  }

  private fun pendingIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
    context,
    0,
    Intent(Commands.BEDTIME_NOW).setPackage(context.packageName),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )
}
