package app.lelap.cast

/**
 * Android 17's local network permission. Apps that target API 37 need it at run time for
 * discovery (SSDP, mDNS), for talking to receivers and for the file server they fetch from.
 * Apps that target less have it with INTERNET, and should not ask.
 */
object LocalNetwork {
  const val PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"
  const val API_LEVEL = 37

  const val GRANTED = "granted"
  const val ASK = "ask"
  const val BLOCKED = "blocked"

  fun needed(sdk: Int, targetSdk: Int): Boolean = sdk >= API_LEVEL && targetSdk >= API_LEVEL

  fun access(granted: Boolean, canAskAgain: Boolean): String = when {
    granted -> GRANTED
    canAskAgain -> ASK
    else -> BLOCKED
  }
}
