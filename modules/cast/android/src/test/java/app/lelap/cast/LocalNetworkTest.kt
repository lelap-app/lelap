package app.lelap.cast

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalNetworkTest {
  @Test
  fun onlyAskedOnAndroid17ByAnAppThatTargetsIt() {
    assertTrue(LocalNetwork.needed(sdk = 37, targetSdk = 37))
    // Targeting less, Android grants local network access with INTERNET.
    assertFalse(LocalNetwork.needed(sdk = 37, targetSdk = 36))
    assertFalse(LocalNetwork.needed(sdk = 36, targetSdk = 37))
  }

  @Test
  fun answers() {
    assertEquals("granted", LocalNetwork.access(granted = true, canAskAgain = false))
    assertEquals("ask", LocalNetwork.access(granted = false, canAskAgain = true))
    assertEquals("blocked", LocalNetwork.access(granted = false, canAskAgain = false))
  }
}
