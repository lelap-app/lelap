package app.lelap.audio

import androidx.media3.common.PlaybackException
import app.lelap.text.NativeCatalog

/**
 * The line under the player when playback fails, in the profile's language. Media3's own message
 * and code name are English for developers; diagnostics keep the code.
 */
object PlayerErrors {
  fun text(code: Int, message: String?, text: NativeCatalog): String = when (code) {
    // Casting's errors are already in the profile's language (modules/cast).
    PlaybackException.ERROR_CODE_REMOTE_ERROR -> message?.takeIf { it.isNotBlank() } ?: text.t("Casting stopped")
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
    PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
    -> text.t("No answer from the server.")
    PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE -> text.t("The server sent a message instead of the file.")
    PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS -> text.t("The server would not send the file.")
    PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> text.t("The file is gone. It may have been moved or deleted.")
    PlaybackException.ERROR_CODE_IO_NO_PERMISSION ->
      text.t("Lelap may no longer read this file. Choose its folder again in Settings.")
    else -> when (code / 1000) {
      3 -> text.t("This file can’t be read. It may be damaged, or in a format Lelap does not play.")
      4 -> text.t("This phone can’t play this kind of audio.")
      5 -> text.t("The phone’s sound output failed. Press play to try again.")
      6 -> text.t("This file is copy-protected, so Lelap can’t play it.")
      else -> text.t("The file could not be played. Press play to try again.")
    }
  }

  /** Audio still preparing after the player waited 10 minutes for it (M155). */
  fun stillPreparing(text: NativeCatalog): String =
    text.t("The source is still getting this book ready. Try again later, or download it when ready.")
}
