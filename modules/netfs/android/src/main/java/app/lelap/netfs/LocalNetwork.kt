package app.lelap.netfs

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/**
 * Android 17's local network permission, needed at run time for casting (discovery, receivers,
 * the file server they fetch from) and for library servers on the home network: SMB, SFTP and
 * HTTP servers at a LAN address. Android's docs say apps that target API 36 or less have it with
 * INTERNET, but a Pixel on Android 17 refused it to Lelap at target 36 (`appops` mode `ignore`), so
 * it is checked on every Android 17 device whatever the target. It lives here because casting,
 * downloads and playback all depend on this module.
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

  /** Whether work on the local network ([local]) is refused for want of the permission. */
  fun blocks(sdk: Int, local: Boolean, granted: Boolean): Boolean = local && needed(sdk) && !granted

  /** Whether this phone lets Lelap reach the local network now. */
  fun granted(context: Context): Boolean =
    !needed(Build.VERSION.SDK_INT) ||
      context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED
}
