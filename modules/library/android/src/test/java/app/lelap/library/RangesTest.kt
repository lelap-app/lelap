package app.lelap.library

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RangesTest {
  @Test fun `reads the total from Content-Range`() {
    assertEquals(12345L, Ranges.total("bytes 0-0/12345"))
    assertNull(Ranges.total("bytes 0-0/*"))
    assertNull(Ranges.total(null))
  }
}
