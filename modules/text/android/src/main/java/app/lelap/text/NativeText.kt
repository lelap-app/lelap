package app.lelap.text

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject

/**
 * The profile's language for native text. The app saves its lines here whenever the language
 * changes, so notifications, the widget and the tile use them with the app closed too.
 */
object NativeText {
  /** Sent to our own package after new lines are saved, so the widget and the player redraw. */
  const val CHANGED = "app.lelap.text.CHANGED"
  private const val PREFS = "lelap_native_text"
  private const val KEY_CATALOG = "catalog"
  /** Channel id → its English name and importance, to rename the channels on a switch. */
  private const val KEY_CHANNELS = "channels"

  @Volatile private var cached: NativeCatalog? = null
  @Volatile private var ensured: Set<String> = emptySet()

  fun get(context: Context): NativeCatalog = cached ?: NativeCatalog
    .decode(prefs(context).getString(KEY_CATALOG, null))
    .also { cached = it }

  fun t(context: Context, english: String, vararg vars: Pair<String, Any>): String = get(context).t(english, *vars)

  // Synchronized with channel(): the player, download workers and alerts call it from their own
  // threads, and each rewrites the one list of channels.
  @Synchronized fun save(context: Context, catalog: NativeCatalog) {
    prefs(context).edit().putString(KEY_CATALOG, catalog.encode()).apply()
    cached = catalog
    val channels = channels(context)
    for (id in channels.keys()) {
      val channel = channels.optJSONObject(id) ?: continue
      create(context, id, channel.optString("name"), channel.optInt("importance"))
    }
    context.sendBroadcast(Intent(CHANGED).setPackage(context.packageName))
  }

  /** Creates the notification channel, or renames it into the current language. */
  @Synchronized fun channel(context: Context, id: String, english: String, importance: Int) {
    // Download progress asks on every update; once per process is enough, since save() renames
    // every channel on a switch.
    if (id in ensured) return
    val channels = channels(context)
    if (channels.optJSONObject(id)?.optString("name") != english) {
      channels.put(id, JSONObject().put("name", english).put("importance", importance))
      prefs(context).edit().putString(KEY_CHANNELS, channels.toString()).apply()
    }
    create(context, id, english, importance)
    ensured = ensured + id
  }

  private fun create(context: Context, id: String, english: String, importance: Int) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || english.isEmpty()) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    // For an existing channel this only changes its name; the user's choices stay.
    manager.createNotificationChannel(NotificationChannel(id, t(context, english), importance))
  }

  private fun channels(context: Context): JSONObject =
    runCatching { JSONObject(prefs(context).getString(KEY_CHANNELS, null) ?: "{}") }.getOrElse { JSONObject() }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
