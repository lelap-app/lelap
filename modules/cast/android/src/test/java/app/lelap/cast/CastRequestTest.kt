package app.lelap.cast

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CastRequestTest {
  private fun request(headers: Map<String, String> = emptyMap(), viaPhone: Boolean = false) =
    CastRequest("http://nas:4533/rest/stream?id=a", "T", null, null, null, 1_000, headers, null, viaPhone)

  @Test
  fun aLoginInTheHeadersOrTheAddressGoesThroughThePhone() {
    assertFalse(request().throughPhone)
    assertTrue(request(headers = mapOf("Authorization" to "Basic x")).throughPhone)
    // A Subsonic token is in the address: the receiver must never get that address.
    assertTrue(request(viaPhone = true).throughPhone)
  }
}
