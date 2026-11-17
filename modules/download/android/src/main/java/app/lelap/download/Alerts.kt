package app.lelap.download

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.lelap.text.NativeText

private const val CHANNEL_ID = "wanted"

/** One-off notifications, such as a wanted book that can now be played. */
object Alerts {
  fun canNotify(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED

  /** Posts a notification; a tap opens [link] in the app, or just the app. False without permission. */
  fun post(context: Context, tag: String, title: String, text: String, link: String?): Boolean {
    if (!canNotify(context)) return false
    val manager = context.getSystemService(NotificationManager::class.java)
    NativeText.channel(context, CHANNEL_ID, "Wanted books", NotificationManager.IMPORTANCE_DEFAULT)
    val intent = if (link != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName)
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName)
    }
    val open = intent?.let {
      PendingIntent.getActivity(
        context,
        tag.hashCode(),
        it,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(title)
      .setContentText(text)
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    manager.notify(tag, 0, notification)
    return true
  }
}
