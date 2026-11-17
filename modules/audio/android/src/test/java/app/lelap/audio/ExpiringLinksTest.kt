package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Test

class ExpiringLinksTest {
  @Test fun expiredLinksAreRefreshedOnce() {
    assertEquals(LinkRetry.REFRESH, ExpiringLinks.decide(403, 1))
    assertEquals(LinkRetry.REFRESH, ExpiringLinks.decide(410, 1))
    assertEquals(LinkRetry.GIVE_UP, ExpiringLinks.decide(403, 2))
  }

  @Test fun otherStatusesKeepTheDefaultPolicy() {
    assertEquals(LinkRetry.DEFAULT, ExpiringLinks.decide(404, 1))
    assertEquals(LinkRetry.DEFAULT, ExpiringLinks.decide(503, 3))
  }
}
