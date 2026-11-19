package app.lelap.updater

import android.content.pm.PackageInstaller
import app.lelap.text.NativeCatalog
import org.junit.Assert.assertEquals
import org.junit.Test

class InstallFailureTest {
  private val ms = NativeCatalog("ms", mapOf("The update was not installed." to "Kemas kini tidak dipasang."))

  @Test fun namesTheStatus() {
    assertEquals("The phone’s storage is full.", InstallFailure.text(PackageInstaller.STATUS_FAILURE_STORAGE, NativeCatalog.ENGLISH))
    assertEquals("The update was cancelled.", InstallFailure.text(PackageInstaller.STATUS_FAILURE_ABORTED, NativeCatalog.ENGLISH))
  }

  @Test fun anythingElseIsNotInstalled() {
    assertEquals("Kemas kini tidak dipasang.", InstallFailure.text(PackageInstaller.STATUS_FAILURE, ms))
    assertEquals("Kemas kini tidak dipasang.", InstallFailure.text(42, ms))
  }
}
