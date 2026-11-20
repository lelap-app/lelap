package app.lelap.download

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DownloadRulesTest {
  @Test fun `takes a JSON or XML answer for a message, not a file`() {
    assertEquals(true, DownloadRules.isMessage("application/json; charset=utf-8"))
    assertEquals(true, DownloadRules.isMessage("text/xml"))
    assertEquals(false, DownloadRules.isMessage("audio/mpeg"))
    assertEquals(false, DownloadRules.isMessage("application/octet-stream"))
    assertEquals(false, DownloadRules.isMessage(null))
  }

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

  @Test fun `waits for a source that is still preparing`() {
    assertEquals(Resume.PREPARING, DownloadRules.decide(503, 0, null, 0, retryAfter = "120"))
    assertEquals(Resume.RETRY, DownloadRules.decide(503, 0, null, 0))
    assertEquals(Resume.RETRY, DownloadRules.decide(503, 0, null, 0, retryAfter = "soon"))
  }

  @Test fun `reads Retry-After as seconds or a date, held between 5 seconds and an hour`() {
    val now = 1_700_000_000_000L
    assertEquals(120L, DownloadRules.retryAfterSeconds("120", now))
    assertEquals(5L, DownloadRules.retryAfterSeconds("0", now))
    assertEquals(3600L, DownloadRules.retryAfterSeconds("86400", now))
    // 2023-11-14 22:13:20 GMT is `now`; a minute later.
    assertEquals(60L, DownloadRules.retryAfterSeconds("Tue, 14 Nov 2023 22:14:20 GMT", now))
    assertNull(DownloadRules.retryAfterSeconds("soon", now))
    assertNull(DownloadRules.retryAfterSeconds(null, now))
  }

  @Test fun `shows a short plain-text reason when a file won't come`() {
    assertEquals("The source no longer has this file.", DownloadRules.endMessage("text/plain; charset=utf-8", "The source no longer has this file.\n"))
    assertNull(DownloadRules.endMessage("text/html", "<p>Gone</p>"))
    assertNull(DownloadRules.endMessage("text/plain", "x".repeat(201)))
    assertNull(DownloadRules.endMessage("text/plain", ""))
  }
}
