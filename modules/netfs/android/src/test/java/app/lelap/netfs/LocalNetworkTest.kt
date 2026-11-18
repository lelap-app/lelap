package app.lelap.netfs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalNetworkTest {
  @Test
  fun askedOnEveryAndroid17Device() {
    assertTrue(LocalNetwork.needed(sdk = 37))
    assertTrue(LocalNetwork.needed(sdk = 38))
    // Android 16 and earlier have no such permission.
    assertFalse(LocalNetwork.needed(sdk = 36))
  }

  @Test
  fun answers() {
    assertEquals("granted", LocalNetwork.access(granted = true, canAskAgain = false))
    assertEquals("ask", LocalNetwork.access(granted = false, canAskAgain = true))
    assertEquals("blocked", LocalNetwork.access(granted = false, canAskAgain = false))
  }

  @Test
  fun blocksOnlyLocalWorkWithoutThePermissionOnAndroid17() {
    assertTrue(LocalNetwork.blocks(sdk = 37, local = true, granted = false))
    assertFalse(LocalNetwork.blocks(sdk = 37, local = true, granted = true))
    // A server on the internet needs no local network access.
    assertFalse(LocalNetwork.blocks(sdk = 37, local = false, granted = false))
    assertFalse(LocalNetwork.blocks(sdk = 36, local = true, granted = false))
  }
}
