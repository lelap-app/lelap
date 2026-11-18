package app.lelap.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.view.View
import android.widget.RemoteViews
import app.lelap.text.NativeText
import java.util.concurrent.Executors

/** Draws every Lelap widget from the saved [NowPlayingSnapshot]; no JavaScript involved. */
object WidgetRenderer {
  // Covers come over the network, so drawing happens off the main thread, one pass at a time.
  private val worker = Executors.newSingleThreadExecutor()

  /** Redraws [ids] (all widgets when null) in the background, then calls [done]. */
  fun updateAsync(context: Context, ids: IntArray? = null, done: () -> Unit = {}) {
    val app = context.applicationContext
    worker.execute {
      try {
        update(app, ids)
      } finally {
        done()
      }
    }
  }

  private fun update(context: Context, only: IntArray?) {
    val manager = AppWidgetManager.getInstance(context)
    val ids = only ?: manager.getAppWidgetIds(ComponentName(context, PlayerWidgetProvider::class.java))
    if (ids.isEmpty()) return
    val model = Models.widget(NowPlayingSnapshot.read(context), NativeText.get(context))
    val cover = runCatching { CoverLoader.load(context, model.coverUri) }.getOrNull()
    for (id in ids) {
      val minHeight = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
      manager.updateAppWidget(id, views(context, model, Models.isTall(minHeight), cover))
    }
  }

  private fun views(context: Context, model: WidgetModel, tall: Boolean, cover: Bitmap?): RemoteViews {
    val views = RemoteViews(context.packageName, if (tall) R.layout.lelap_widget_large else R.layout.lelap_widget_small)
    views.setTextViewText(R.id.lelap_widget_title, model.title)
    views.setTextViewText(R.id.lelap_widget_subtitle, model.subtitle.orEmpty())
    views.setViewVisibility(R.id.lelap_widget_subtitle, if (model.subtitle == null) View.GONE else View.VISIBLE)
    if (tall) {
      views.setTextViewText(R.id.lelap_widget_detail, model.detail.orEmpty())
      views.setViewVisibility(R.id.lelap_widget_detail, if (model.detail == null) View.GONE else View.VISIBLE)
    }
    if (cover != null) {
      views.setImageViewBitmap(R.id.lelap_widget_cover, cover)
    } else {
      views.setImageViewResource(R.id.lelap_widget_cover, R.drawable.lelap_widget_cover_placeholder)
    }
    views.setImageViewResource(R.id.lelap_widget_play, if (model.playing) R.drawable.lelap_widget_pause else R.drawable.lelap_widget_play)
    views.setContentDescription(R.id.lelap_widget_play, model.playLabel)
    views.setContentDescription(R.id.lelap_widget_back, model.backLabel)
    views.setContentDescription(R.id.lelap_widget_forward, model.forwardLabel)
    views.setContentDescription(R.id.lelap_widget_root, model.openLabel)
    // With no book at all there is nothing to skip in; Play stays, to resume one if it can.
    val skips = if (model.hasBook) View.VISIBLE else View.INVISIBLE
    views.setViewVisibility(R.id.lelap_widget_back, skips)
    views.setViewVisibility(R.id.lelap_widget_forward, skips)
    views.setTextViewText(R.id.lelap_widget_back_seconds, model.skipSeconds.toString())
    views.setTextViewText(R.id.lelap_widget_forward_seconds, model.skipSeconds.toString())

    views.setOnClickPendingIntent(R.id.lelap_widget_root, Links.openPlayer(context))
    views.setOnClickPendingIntent(R.id.lelap_widget_play, action(context, PlayerRemote.Action.PLAY_PAUSE))
    views.setOnClickPendingIntent(R.id.lelap_widget_back, action(context, PlayerRemote.Action.BACK))
    views.setOnClickPendingIntent(R.id.lelap_widget_forward, action(context, PlayerRemote.Action.FORWARD))
    return views
  }

  private fun action(context: Context, action: PlayerRemote.Action): PendingIntent = PendingIntent.getBroadcast(
    context,
    action.ordinal,
    Intent(context, WidgetActionReceiver::class.java).setAction(WidgetActionReceiver.PREFIX + action.name),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )
}
