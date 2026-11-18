package app.lelap.updater

/** Which of a release's APKs this device installs. Pure, so it is tested on the JVM. */
object AbiChoice {
  /**
   * The first CPU type in [supported] that the release [offered] an APK for, or null. [supported]
   * is `Build.SUPPORTED_ABIS`, most preferred first, so a 64-bit phone takes the 64-bit APK.
   */
  fun pick(supported: List<String>, offered: List<String>): String? =
    supported.firstOrNull { it in offered }
}
