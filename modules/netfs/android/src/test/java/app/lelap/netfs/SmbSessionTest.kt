package app.lelap.netfs

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SmbSessionTest {
  @Test
  fun requiresSigningForLoggedInSessionsOnly() {
    assertTrue(SmbSession.signs(NetLogin("me", password = "pw")))
    assertTrue(SmbSession.signs(NetLogin("OFFICE\\me", password = "pw")))
    // A guest account with a password is an account like any other.
    assertTrue(SmbSession.signs(NetLogin("guest", password = "pw")))
    assertFalse(SmbSession.signs(NetLogin("guest")))
    assertFalse(SmbSession.signs(NetLogin("")))
  }
}
