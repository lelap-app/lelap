package app.lelap.download

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DownloadRulesTest {
  @Test fun `parses Content-Range`() {
    assertEquals(100L, DownloadRules.contentRangeStart("bytes 100-199/200"))
    assertEquals(200L, DownloadRules.contentRangeTotal("bytes 100-199/200"))
    assertEquals(500L, DownloadRules.contentRangeTotal("bytes */500"))
    assertNull(DownloadRules.contentRangeStart("bytes */500"))
    assertNull(DownloadRules.contentRangeStart(null))
    assertNull(DownloadRules.contentRangeTotal("nonsense"))
  }

  @Test fun `appends only when the range starts where the part ends`() {
    assertEquals(Resume.APPEND, DownloadRules.decide(206, 100, "bytes 100-199/200", 200))
    assertEquals(Resume.DISCARD, DownloadRules.decide(206, 100, "bytes 0-199/200", 200))
    assertEquals(Resume.DISCARD, DownloadRules.decide(206, 0, "bytes 0-199/200", 200))
  }

  @Test fun `starts over when the server ignores the range`() {
    assertEquals(Resume.RESTART, DownloadRules.decide(200, 100, null, 200))
    assertEquals(Resume.RESTART, DownloadRules.decide(200, 0, null, 0))
  }

  @Test fun `treats an unsatisfiable range on a complete part as done`() {
    assertEquals(Resume.COMPLETE, DownloadRules.decide(416, 200, "bytes */200", 0))
    assertEquals(Resume.COMPLETE, DownloadRules.decide(416, 200, null, 200))
    assertEquals(Resume.DISCARD, DownloadRules.decide(416, 300, "bytes */200", 200))
    assertEquals(Resume.DISCARD, DownloadRules.decide(416, 0, null, 0))
  }

  @Test fun `retries temporary failures and gives up on refusals`() {
    listOf(408, 429, 500, 503).forEach { assertEquals(Resume.RETRY, DownloadRules.decide(it, 0, null, 0)) }
    listOf(401, 404).forEach { assertEquals(Resume.FAIL, DownloadRules.decide(it, 0, null, 0)) }
  }

  @Test fun expiredLinksAreAskedForAgainOnce() {
    listOf(403, 410).forEach {
      assertEquals(Resume.REFRESH, DownloadRules.decide(it, 4_096, null, 0))
      assertEquals(Resume.FAIL, DownloadRules.decide(it, 4_096, null, 0, refreshed = true))
    }
  }

  @Test fun `derives the state JavaScript sees`() {
    assertEquals("running", DownloadRules.state(partsDone = true, WorkState.RUNNING, hasError = false))
    assertEquals("waiting", DownloadRules.state(partsDone = false, WorkState.ENQUEUED, hasError = false))
    assertEquals("waiting", DownloadRules.state(partsDone = false, WorkState.BLOCKED, hasError = true))
    assertEquals("done", DownloadRules.state(partsDone = true, WorkState.SUCCEEDED, hasError = false))
    // WorkManager prunes finished work after a while; the files still say it is done.
    assertEquals("done", DownloadRules.state(partsDone = true, WorkState.NONE, hasError = false))
    assertEquals("failed", DownloadRules.state(partsDone = false, WorkState.FAILED, hasError = true))
    assertEquals("failed", DownloadRules.state(partsDone = false, WorkState.NONE, hasError = true))
    assertEquals("stopped", DownloadRules.state(partsDone = false, WorkState.CANCELLED, hasError = false))
    assertEquals("stopped", DownloadRules.state(partsDone = false, WorkState.NONE, hasError = false))
  }
}
