package app.lelap.cast

/**
 * Android 17's local network permission, needed at run time for discovery (SSDP, mDNS), for
 * talking to receivers and for the file server they fetch from. Android's docs say apps that target
 * API 36 or less have it with INTERNET, but a Pixel on Android 17 refused it to Lelap at target 36
 * (`appops` mode `ignore`), so it is checked on every Android 17 device whatever the target.
 */
object LocalNetwork {
  const val PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"
  const val API_LEVEL = 37

  const val GRANTED = "granted"
  const val ASK = "ask"
  const val BLOCKED = "blocked"

  fun needed(sdk: Int): Boolean = sdk >= API_LEVEL

  fun access(granted: Boolean, canAskAgain: Boolean): String = when {
    granted -> GRANTED
    canAskAgain -> ASK
    else -> BLOCKED
  }
}
