package app.lelap.netfs

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The failure's kind as the error code, which the app turns into its own words. */
private class NetfsException(failure: NetFailure) : CodedException(failure.kind.code, failure.message, null)

private class AddonFetchException(code: String, message: String?) : CodedException(code, message, null)

/** Lists, checks and copies files on SMB and SFTP servers for the app's scan and "Add a server". */
class NetfsModule : Module() {
  private val addonFetch by lazy { AddonFetch() }

  private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) {
    try {
      block()
    } catch (e: NetFailure) {
      throw NetfsException(e)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("LelapNetfs")

    // The key's fingerprint, before any login is sent: the listener compares it, then trusts it.
    AsyncFunction("hostKey") Coroutine { uri: String ->
      io {
        val key = Netfs.hostKey(uri)
        mapOf("fingerprint" to key.fingerprint, "algorithm" to key.algorithm)
      }
    }

    AsyncFunction("check") Coroutine { uri: String, headers: Map<String, String> ->
      io {
        val (folders, files) = Netfs.check(uri, headers)
        mapOf("folders" to folders, "files" to files)
      }
    }

    AsyncFunction("list") Coroutine { uri: String, headers: Map<String, String> ->
      io {
        Netfs.list(uri, headers).map {
          mapOf("path" to it.path, "size" to it.size.toDouble(), "modifiedAt" to it.modifiedAt.toDouble())
        }
      }
    }

    // `lelap.fetch` for add-ons inside the app: their declared hosts reach only public addresses.
    AsyncFunction("addonFetch") Coroutine { url: String, init: Map<String, Any?> ->
      withContext(Dispatchers.IO) {
        @Suppress("UNCHECKED_CAST")
        val headers = (init["headers"] as? Map<String, Any?>)
          ?.mapNotNull { (k, v) -> (v as? String)?.let { k to it } }?.toMap() ?: emptyMap()
        try {
          val answer = addonFetch.fetch(
            url = url,
            method = init["method"] as? String ?: "GET",
            headers = headers,
            body = init["body"] as? String,
            timeoutMs = (init["timeoutMs"] as? Number)?.toLong() ?: 20_000L,
            maxBytes = (init["maxBytes"] as? Number)?.toLong() ?: 20_000_000L,
            localNetwork = init["localNetwork"] == true,
          )
          mapOf("status" to answer.status, "url" to answer.url, "text" to answer.text, "headers" to answer.headers)
        } catch (e: PrivateAddressException) {
          throw AddonFetchException("ERR_ADDON_PRIVATE", e.message)
        } catch (e: TooLargeException) {
          throw AddonFetchException("ERR_ADDON_TOO_LARGE", e.message)
        } catch (e: Exception) {
          throw AddonFetchException("ERR_ADDON_FETCH", e.message ?: e.javaClass.simpleName)
        }
      }
    }

    AsyncFunction("copyTo") Coroutine { uri: String, headers: Map<String, String>, path: String ->
      io {
        val target = File(path)
        try {
          Netfs.copyTo(uri, headers, target)
        } catch (e: Exception) {
          target.delete()
          throw e
        }
      }
    }
  }
}
