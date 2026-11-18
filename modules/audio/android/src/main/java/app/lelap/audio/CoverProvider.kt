package app.lelap.audio

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException

/**
 * Read-only covers for Android Auto's browse lists (M74); see [CarCovers]. Exported, since Auto
 * runs in its own process, but it only opens covers of books the car lists at that moment.
 */
class CoverProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw SecurityException("Covers are read-only")
    val context = context ?: throw FileNotFoundException(uri.toString())
    val key = uri.lastPathSegment ?: throw FileNotFoundException(uri.toString())
    val cover = CarCovers.find(key, snapshot(context), journal(context))
      ?: throw FileNotFoundException(uri.toString())
    if (cover.startsWith("content://")) {
      // A cover in a download folder the user picked; Lelap holds the grant, Auto does not.
      return context.contentResolver.openFileDescriptor(Uri.parse(cover), "r")
        ?: throw FileNotFoundException(uri.toString())
    }
    // `localFileUri` in packages/core writes the path as it is, without escaping.
    val raw = File(cover.removePrefix("file://"))
    val file = if (raw.exists()) raw else File(Uri.parse(cover).path ?: throw FileNotFoundException(uri.toString()))
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun getType(uri: Uri): String {
    val cover = context?.let { CarCovers.find(uri.lastPathSegment.orEmpty(), snapshot(it), journal(it)) }
    return CarCovers.mimeType(cover)
  }

  private fun snapshot(context: Context): CarSnapshot = CarLibrary.decode(
    context.getSharedPreferences(Commands.AUDIO_PREFS, Context.MODE_PRIVATE).getString(Commands.PREF_CAR_LIBRARY, null),
  )

  private fun journal(context: Context): BookPlaylist? {
    val prefs = context.getSharedPreferences(Commands.JOURNAL_PREFS, Context.MODE_PRIVATE)
    return PositionJournal.decode(prefs.getString(Commands.JOURNAL_KEY, null), prefs.getString(Commands.JOURNAL_PLAYLIST_KEY, null))?.second
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
