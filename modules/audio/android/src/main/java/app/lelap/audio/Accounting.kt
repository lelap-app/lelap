package app.lelap.audio

import android.content.Context
import java.util.UUID

/**
 * The process's one [AccountingLog], kept in its own preferences file. The service writes to it
 * on the main thread and the app's module takes and acknowledges from its own queue, so every
 * change runs under this object's lock.
 */
object Accounting {
  private const val PREFS = "lelap_accounting"
  private const val KEY = "log"

  private var log: AccountingLog? = null

  /** Changes the log and saves it; [durable] waits for the disk, for when the process may die next. */
  @Synchronized
  fun <T> edit(context: Context, durable: Boolean = false, change: (AccountingLog) -> T): T {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val current = log ?: AccountingLog.decode(prefs.getString(KEY, null)) { UUID.randomUUID().toString() }
      .also { log = it }
    val before = current.encode()
    val result = change(current)
    val after = current.encode()
    if (after != before) {
      val editor = prefs.edit().putString(KEY, after)
      if (durable) editor.commit() else editor.apply()
    }
    return result
  }
}
