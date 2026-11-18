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

/** Lists, checks and copies files on SMB and SFTP servers for the app's scan and "Add a server". */
class NetfsModule : Module() {
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
