package app.lelap.netfs

import app.lelap.text.NativeCatalog
import app.lelap.text.Reasons
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException

class MessagesTest {
  private val ms = NativeCatalog(
    "ms",
    mapOf("The server refused the login. Log in again in Settings." to "Pelayan menolak log masuk."),
  )

  @Test fun anSmbOrSftpFailureNamesItselfInsideAnother() {
    val refused = NetFailure(NetFailure.Kind.LOGIN, "The server refused the login.")
    assertEquals("Pelayan menolak log masuk.", Reasons.of(IOException("read failed", refused), ms))
    assertEquals(
      "The file is no longer on the server.",
      Reasons.of(RuntimeException(NetFailure(NetFailure.Kind.NOT_FOUND, "gone")), NativeCatalog.ENGLISH),
    )
  }
}
