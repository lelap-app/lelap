package app.lelap.download

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.DocumentsContract
import android.provider.Settings
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Serializable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class InvalidJobException : CodedException("The download job is not valid.")

class PickLocationInput : Serializable

private class PickLocationContract : AppContextActivityResultContract<PickLocationInput, Uri?> {
  override fun createIntent(context: Context, input: PickLocationInput): Intent =
    Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
      Intent.FLAG_GRANT_READ_URI_PERMISSION or
        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
    )

  override fun parseResult(input: PickLocationInput, resultCode: Int, intent: Intent?): Uri? =
    if (resultCode == Activity.RESULT_OK) intent?.data else null
}

/** Bridges JavaScript to the download worker. The app folds the statuses into SQLite. */
class DownloadModule : Module() {
  private lateinit var picker: AppContextActivityResultLauncher<PickLocationInput, Uri?>

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LelapDownload")

    RegisterActivityContracts {
      picker = registerForActivityResult(PickLocationContract())
    }

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

    AsyncFunction("location") Coroutine { ->
      withContext(Dispatchers.IO) { location() }
    }

    // Android's folder picker; the folder keeps read and write access across restarts.
    AsyncFunction("chooseLocation") Coroutine { ->
      val uri = picker.launch(PickLocationInput()) ?: return@Coroutine false
      withContext(Dispatchers.IO) {
        context.contentResolver.takePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        Downloads.setLocation(context, uri.toString())
        Mover.start(context)
      }
      true
    }

    AsyncFunction("resetLocation") Coroutine { ->
      withContext(Dispatchers.IO) {
        Downloads.setLocation(context, null)
        Mover.start(context)
      }
    }

    AsyncFunction("releaseOld") Coroutine { bookId: String, location: String? ->
      withContext(Dispatchers.IO) { Downloads.releaseOld(context, bookId, location) }
    }

    AsyncFunction("resumeMove") Coroutine { ->
      withContext(Dispatchers.IO) { Mover.resume(context) }
    }

    Function("canNotify") { Alerts.canNotify(context) }

    Function("notify") { tag: String, title: String, text: String, link: String? ->
      Alerts.post(context, tag, title, text, link)
    }

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

  /** Where new downloads go and how the move there is getting on. */
  private fun location(): Map<String, Any?> {
    val uri = Downloads.location(context)
    val documentId = uri?.let { runCatching { DocumentsContract.getTreeDocumentId(Uri.parse(it)) }.getOrNull() }
    return mapOf(
      "uri" to uri,
      "volume" to documentId?.let(LocationRules::volumeOf)?.let { if (it == LocationRules.PRIMARY) "primary" else "removable" },
      "path" to documentId?.let(LocationRules::pathOf),
      "available" to Downloads.place(context, uri).available(),
      "moving" to Mover.isMoving(context),
      "waiting" to Mover.waiting(context).toDouble(),
      "error" to Mover.error(context),
    )
  }
}
