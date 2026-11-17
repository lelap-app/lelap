package app.lelap.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

object Links {
  // The app's scheme (`scheme` in apps/app/app.json) and Expo Router's player route.
  private const val PLAYER_LINK = "lelap://player"

  fun playerIntent(context: Context): Intent =
    Intent(Intent.ACTION_VIEW, Uri.parse(PLAYER_LINK))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

  fun openPlayer(context: Context): PendingIntent = PendingIntent.getActivity(
    context,
    0,
    playerIntent(context),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )
}
