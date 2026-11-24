package app.lelap.download

import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * A server with a home and an away address (M146): a download held for Wi-Fi or a charger starts
 * later, maybe on another network, so the address is chosen as it runs (M159), not when queued.
 * The same rule as the app's `tryAddresses`: on no answer at all, once at the other address.
 */
object ServerAddresses {
  /**
   * The file's addresses in the order to try: its own first, or the other one when [preferAlso],
   * as the book's file before came from there in this run.
   */
  fun order(file: JobFile, preferAlso: Boolean): List<String> {
    val all = listOfNotNull(file.url, file.also?.takeIf { it != file.url })
    return if (preferAlso) all.reversed() else all
  }

  /** No answer at all: the address is not there on this network. Any HTTP status is an answer. */
  fun silent(e: IOException): Boolean =
    e is UnknownHostException || e is ConnectException || e is NoRouteToHostException || e is SocketTimeoutException

  /**
   * Runs [fetch] at each address in turn while the one before is silent, and returns the address
   * that answered. When every one is silent, the first one's error; any other error at once.
   */
  suspend fun firstAnswering(addresses: List<String>, fetch: suspend (String) -> Unit): String {
    var first: IOException? = null
    for (address in addresses) {
      try {
        fetch(address)
        return address
      } catch (e: IOException) {
        if (!silent(e)) throw e
        if (first == null) first = e
      }
    }
    throw first ?: IOException("No address to download from")
  }
}
