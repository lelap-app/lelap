package app.lelap.text

import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** A failure whose message is already in the profile's language, so it can be shown as it is. */
open class ShownException(message: String) : IOException(message)

/**
 * A file Lelap keeps for itself (a download's job) could not be saved. [Reasons] names it in the
 * catalog it is given; the message is for JavaScript, which shows it as it is.
 */
class NotSavedException : ShownException(NativeText.current().t("Lelap could not save to the phone’s storage."))

/** A failure that names itself in the profile's language, from a module this one can't see (netfs). */
interface Explained {
  fun reason(text: NativeCatalog): String
}

/**
 * Why something failed, in the profile's language. Android's and Java's own messages follow the
 * phone's language or are English, so only the kind of failure is shown; null when it is unknown.
 */
object Reasons {
  fun of(e: Throwable, text: NativeCatalog): String? {
    for (cause in generateSequence(e) { it.cause }.take(MAX_CAUSES)) {
      reason(cause, text)?.let { return it }
    }
    return null
  }

  private fun reason(e: Throwable, text: NativeCatalog): String? = when {
    e is NotSavedException -> text.t("Lelap could not save to the phone’s storage.")
    e is ShownException -> e.message?.takeIf { it.isNotBlank() }
    e is Explained -> e.reason(text)
    e is UnknownHostException -> text.t("The server’s address can’t be found. Check the connection.")
    e is SocketTimeoutException -> text.t("The server did not answer in time.")
    e is ConnectException || e is NoRouteToHostException -> text.t("No answer from the server.")
    e is SSLException -> text.t("The secure connection to the server failed.")
    noSpace(e) -> text.t("The phone’s storage is full.")
    // The Storage Access Framework throws it when the listener withdrew access to a folder.
    e is SecurityException -> text.t("Lelap may no longer use the folder. Choose it again in Settings.")
    else -> null
  }

  // Android's ErrnoException reaches us inside an IOException, often only as its message.
  private fun noSpace(e: Throwable): Boolean =
    e.message?.let { "ENOSPC" in it || "No space left on device" in it } == true

  private const val MAX_CAUSES = 8
}
