package app.lelap.download

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class InvalidJobException : CodedException("The download job is not valid.")

/** Bridges JavaScript to the download worker. The app folds the statuses into SQLite. */
class DownloadModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LelapDownload")

    Function("directory") { Downloads.root(context).absolutePath }

    // The job travels as JSON so it is written to disk with the same codec the worker reads.
    AsyncFunction("enqueue") { jobJson: String ->
      val job = DownloadJob.decode(jobJson) ?: throw InvalidJobException()
      Downloads.enqueue(context, job)
    }

    AsyncFunction("remove") { bookId: String -> Downloads.remove(context, bookId) }

    AsyncFunction("statuses") { Downloads.statuses(context) }

    AsyncFunction("setRules") { wifiOnly: Boolean, chargingOnly: Boolean ->
      Downloads.setRules(context, Rules(wifiOnly, chargingOnly))
    }

    AsyncFunction("storage") { Downloads.storage(context) }

    Function("isIgnoringBatteryOptimizations") {
      context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
    }

    AsyncFunction("requestBatteryExemption") {
      val intent = Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:${context.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      (appContext.currentActivity ?: context).startActivity(intent)
    }
  }
}
