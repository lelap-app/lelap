package app.lelap.library

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
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

class FolderUnavailableException(cause: Throwable? = null) :
  CodedException("ERR_LELAP_PERMISSION", "The library folder can no longer be read", cause)

class PickFolderInput : Serializable

private class PickFolderContract : AppContextActivityResultContract<PickFolderInput, Uri?> {
  override fun createIntent(context: Context, input: PickFolderInput): Intent =
    Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
      Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
    )

  override fun parseResult(input: PickFolderInput, resultCode: Int, intent: Intent?): Uri? =
    if (resultCode == Activity.RESULT_OK) intent?.data else null
}

/** Folder access through the Storage Access Framework, with a permission that survives restarts. */
class LibraryModule : Module() {
  private lateinit var picker: AppContextActivityResultLauncher<PickFolderInput, Uri?>

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LelapLibrary")

    RegisterActivityContracts {
      picker = registerForActivityResult(PickFolderContract())
    }

    AsyncFunction("pickFolder") Coroutine { ->
      val uri = picker.launch(PickFolderInput()) ?: return@Coroutine null
      context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val location = DocumentsContract.getTreeDocumentId(uri)
      mapOf("uri" to uri.toString(), "name" to location.substringAfterLast('/').substringAfterLast(':'), "location" to location)
    }

    AsyncFunction("hasPermission") { uri: String -> hasPermission(Uri.parse(uri)) }

    AsyncFunction("listTree") Coroutine { uri: String ->
      withContext(Dispatchers.IO) { listTree(Uri.parse(uri)) }
    }
  }

  private fun hasPermission(tree: Uri): Boolean =
    context.contentResolver.persistedUriPermissions.any { it.uri == tree && it.isReadPermission }

  private fun listTree(tree: Uri): List<Map<String, Any>> {
    if (!hasPermission(tree)) throw FolderUnavailableException()
    val rootId = DocumentsContract.getTreeDocumentId(tree)
    val entries = try {
      TreeWalk.walk(rootId) { children(tree, it) }
    } catch (e: SecurityException) {
      throw FolderUnavailableException(e)
    }
    return entries.map {
      mapOf(
        "location" to it.location,
        "relPath" to it.relPath,
        "name" to it.name,
        "size" to it.size.toDouble(),
        "modifiedAt" to it.modifiedAt.toDouble(),
        "uri" to DocumentsContract.buildDocumentUriUsingTree(tree, it.location).toString(),
      )
    }
  }

  private fun children(tree: Uri, documentId: String): List<TreeEntry> {
    val uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
    val columns = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    )
    // A null cursor means the provider cannot reach the folder (storage removed); never treat it
    // as an empty folder, or every book would be marked missing.
    val cursor = context.contentResolver.query(uri, columns, null, null, null) ?: throw FolderUnavailableException()
    return cursor.use {
      buildList {
        while (it.moveToNext()) {
          add(
            TreeEntry(
              documentId = it.getString(0),
              name = it.getString(1) ?: "",
              isDirectory = it.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR,
              size = if (it.isNull(3)) 0L else it.getLong(3),
              modifiedAt = if (it.isNull(4)) 0L else it.getLong(4),
            ),
          )
        }
      }
    }
  }
}
