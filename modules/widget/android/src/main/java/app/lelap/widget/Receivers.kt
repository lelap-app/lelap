package app.lelap.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.service.quicksettings.TileService

/** The home screen widget, in a 4x1 and a 4x2 layout. */
class PlayerWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val pending = goAsync()
    WidgetRenderer.updateAsync(context, ids) { pending.finish() }
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    val pending = goAsync()
    WidgetRenderer.updateAsync(context, intArrayOf(id)) { pending.finish() }
  }
}

/** PlaybackService saved a new [NowPlayingSnapshot]: redraw the widgets and the tile. */
class NowPlayingReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    TileService.requestListeningState(context, ComponentName(context, PlayTileService::class.java))
    val pending = goAsync()
    WidgetRenderer.updateAsync(context) { pending.finish() }
  }
}

/** The widget's play, back and forward buttons. */
class WidgetActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action?.removePrefix(PREFIX)
      ?.let { name -> PlayerRemote.Action.entries.firstOrNull { it.name == name } } ?: return
    val pending = goAsync()
    PlayerRemote.send(context, action) { pending.finish() }
  }

  companion object {
    const val PREFIX = "app.lelap.widget.action."
  }
}
