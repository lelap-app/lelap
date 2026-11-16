package app.lelap.updater

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class UpdateException(message: String) : CodedException(message)

private const val MAX_REDIRECTS = 8

/** Downloads a release APK, checks its SHA-256 and hands it to PackageInstaller. */
class UpdaterModule : Module() {
  companion object {
    /** The last failure PackageInstaller reported, for JavaScript to show. */
    @Volatile var lastError: String? = null
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LelapUpdater")

    Function("versionCode") {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode.toDouble()
      else @Suppress("DEPRECATION") info.versionCode.toDouble()
    }

    Function("canInstall") {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    }

    Function("lastError") { lastError }

    AsyncFunction("openInstallSettings") {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${context.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      (appContext.currentActivity ?: context).startActivity(intent)
    }

    // Blocking work on Expo's background queue: the download, the hash and the session copy.
    AsyncFunction("install") { url: String, sha256: String, size: Double ->
      val apk = File(context.cacheDir, "update.apk")
      download(url, apk)
      if (!Checksum.matches(apk, sha256, size.toLong())) {
        apk.delete()
        throw UpdateException("The download does not match the release. Try again.")
      }
      lastError = null
      startInstall(apk)
    }
  }

  private fun download(url: String, target: File) {
    var current = URL(url)
    repeat(MAX_REDIRECTS) {
      if (current.protocol != "https") throw UpdateException("Updates come only over https.")
      val c = current.openConnection() as HttpURLConnection
      c.instanceFollowRedirects = false
      c.connectTimeout = 30_000
      c.readTimeout = 60_000
      try {
        val code = c.responseCode
        if (code in 300..399) {
          current = URL(current, c.getHeaderField("Location") ?: throw IOException("HTTP $code"))
          return@repeat
        }
        if (code != 200) throw UpdateException("The download answered HTTP $code.")
        c.inputStream.use { input -> target.outputStream().use { input.copyTo(it) } }
        return
      } finally {
        c.disconnect()
      }
    }
    throw UpdateException("Too many redirects.")
  }

  private fun startInstall(apk: File) {
    val installer = context.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setAppPackageName(context.packageName)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
    val sessionId = installer.createSession(params)
    installer.openSession(sessionId).use { session ->
      session.openWrite("lelap.apk", 0, apk.length()).use { out ->
        apk.inputStream().use { it.copyTo(out) }
        session.fsync(out)
      }
      val intent = Intent(context, InstallResultReceiver::class.java)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
      session.commit(PendingIntent.getBroadcast(context, sessionId, intent, flags).intentSender)
    }
  }
}
