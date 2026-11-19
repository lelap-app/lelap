package app.lelap.updater

import android.content.pm.PackageInstaller
import app.lelap.text.NativeCatalog

/** Why PackageInstaller did not install the update, in the profile's language. */
object InstallFailure {
  fun text(status: Int, text: NativeCatalog): String = when (status) {
    PackageInstaller.STATUS_FAILURE_STORAGE -> text.t("The phone’s storage is full.")
    PackageInstaller.STATUS_FAILURE_ABORTED -> text.t("The update was cancelled.")
    PackageInstaller.STATUS_FAILURE_BLOCKED -> text.t("Android blocked the update.")
    PackageInstaller.STATUS_FAILURE_CONFLICT ->
      text.t("The update is signed differently from the installed app, so Android refused it.")
    PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> text.t("The update does not fit this phone.")
    PackageInstaller.STATUS_FAILURE_INVALID -> text.t("The update file is damaged. Try again.")
    else -> text.t("The update was not installed.")
  }
}
