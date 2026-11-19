package app.lelap.text

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

class ReasonsTest {
  private val ms = NativeCatalog(
    "ms",
    mapOf(
      "No answer from the server." to "Tiada jawapan daripada pelayan.",
      "The phone’s storage is full." to "Storan telefon sudah penuh.",
    ),
  )
  private val en = NativeCatalog.ENGLISH

  @Test fun namesTheKindNeverTheSystemText() {
    assertEquals("Tiada jawapan daripada pelayan.", Reasons.of(ConnectException("Verbindung abgelehnt"), ms))
    assertEquals("The server did not answer in time.", Reasons.of(SocketTimeoutException("timeout"), en))
    assertEquals(
      "The server’s address can’t be found. Check the connection.",
      Reasons.of(UnknownHostException("Unable to resolve host"), en),
    )
    assertEquals("The secure connection to the server failed.", Reasons.of(SSLHandshakeException("x"), en))
    assertEquals(
      "Lelap may no longer use the folder. Choose it again in Settings.",
      Reasons.of(SecurityException("Permission Denial"), en),
    )
  }

  @Test fun findsAFullDiskInsideAnotherError() {
    val full = IOException("write failed", IOException("write failed: ENOSPC (No space left on device)"))
    assertEquals("Storan telefon sudah penuh.", Reasons.of(full, ms))
  }

  @Test fun keepsAMessageAlreadyTranslated() {
    assertEquals("Fail itu hilang.", Reasons.of(IOException(ShownException("Fail itu hilang.")), ms))
  }

  @Test fun asksAFailureThatNamesItselfAlsoWhenWrapped() {
    class Named : IOException("internal"), Explained {
      override fun reason(text: NativeCatalog) = text.t("No answer from the server.")
    }
    assertEquals("Tiada jawapan daripada pelayan.", Reasons.of(RuntimeException(Named()), ms))
  }

  @Test fun namesAFileThatCouldNotBeSaved() {
    assertEquals("Lelap could not save to the phone’s storage.", Reasons.of(NotSavedException(), en))
  }

  @Test fun unknownIsNull() {
    assertNull(Reasons.of(IllegalStateException("Something odd"), en))
    assertNull(Reasons.of(ShownException(" "), en))
  }
}
