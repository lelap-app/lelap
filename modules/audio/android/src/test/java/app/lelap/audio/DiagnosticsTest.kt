package app.lelap.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class DiagnosticsTest {
  @Test fun `entries survive their own encoding`() {
    val entries = listOf(
      DiagnosticEntry(1_000, Diagnostics.ERROR, code = 2004, status = 403, bookId = "book-1", part = 2),
      DiagnosticEntry(2_000, Diagnostics.PAUSED_BY_SYSTEM, code = 3),
    )
    assertEquals(entries, Diagnostics.decode(Diagnostics.encode(entries)))
  }

  @Test fun `the log keeps its newest entries only`() {
    var json: String? = null
    for (i in 0 until Diagnostics.LIMIT + 10) {
      json = Diagnostics.append(json, DiagnosticEntry(i.toLong(), Diagnostics.ERROR))
    }
    val kept = Diagnostics.decode(json)
    assertEquals(Diagnostics.LIMIT, kept.size)
    assertEquals(10L, kept.first().at)
    assertEquals((Diagnostics.LIMIT + 9).toLong(), kept.last().at)
  }

  @Test fun `an unreadable log reads as empty, an unreadable entry is left out`() {
    assertEquals(emptyList<DiagnosticEntry>(), Diagnostics.decode("not json"))
    assertEquals(emptyList<DiagnosticEntry>(), Diagnostics.decode(null))
    val mixed = """[{"at":5,"what":"ended"},{"what":"no time"},7]"""
    assertEquals(listOf(DiagnosticEntry(5, "ended")), Diagnostics.decode(mixed))
  }

  @Test fun `an entry holds no text beyond its word and the book's ID`() {
    val json = Diagnostics.encode(listOf(DiagnosticEntry(1, Diagnostics.LINK_REFRESHED, status = 410, bookId = "b")))
    assertEquals("""[{"at":1,"what":"link-refreshed","status":410,"bookId":"b"}]""", json)
    assertFalse(json.contains("http"))
  }

  @Test fun `only pauses the system made are logged`() {
    assertNull(Diagnostics.pauseEvent(false, Diagnostics.REASON_USER_REQUEST))
    assertNull(Diagnostics.pauseEvent(true, Diagnostics.REASON_USER_REQUEST))
    assertNull(Diagnostics.pauseEvent(false, Diagnostics.REASON_END_OF_MEDIA_ITEM))
    // 2: AUDIO_FOCUS_LOSS; resuming says nothing about trouble.
    assertNull(Diagnostics.pauseEvent(true, 2))
    // 3: AUDIO_BECOMING_NOISY, headphones unplugged.
    assertEquals(Diagnostics.PAUSED_BY_SYSTEM, Diagnostics.pauseEvent(false, 3))
  }

  @Test fun `focus changes have the app's words`() {
    assertEquals("focus-lost", Diagnostics.focusEvent(FocusAction.PAUSE))
    assertEquals("focus-lost-briefly", Diagnostics.focusEvent(FocusAction.PAUSE_TRANSIENT))
    assertEquals("focus-ducked", Diagnostics.focusEvent(FocusAction.DUCK))
    assertNull(Diagnostics.focusEvent(FocusAction.RESTORE))
  }
}
