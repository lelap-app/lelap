package app.lelap.text

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeCatalogTest {
  private val ms = NativeCatalog(
    "ms",
    mapOf(
      "Pause" to "Jeda",
      "Back {n} seconds" to "Undur {n} saat",
      "Not yet" to "",
    ),
  )

  @Test fun translatesAndFillsHoles() {
    assertEquals("Jeda", ms.t("Pause"))
    assertEquals("Undur 30 saat", ms.t("Back {n} seconds", "n" to 30))
  }

  @Test fun missingOrEmptyLinesShowTheEnglish() {
    assertEquals("Play", ms.t("Play"))
    assertEquals("Not yet", ms.t("Not yet"))
    assertEquals("Forward 15 seconds", ms.t("Forward {n} seconds", "n" to 15))
  }

  @Test fun unknownHolesStay() {
    assertEquals("Undur {n} saat", ms.t("Back {n} seconds"))
    assertEquals("Undur {n} saat", ms.t("Back {n} seconds", "other" to 1))
  }

  @Test fun survivesSaving() {
    val back = NativeCatalog.decode(ms.encode())
    assertEquals("ms", back.language)
    assertEquals("Jeda", back.t("Pause"))
    assertEquals(ms.encode(), back.encode())
  }

  @Test fun nothingSavedOrUnreadableIsEnglish() {
    for (saved in listOf(null, "", "not json", "{}")) {
      val catalog = NativeCatalog.decode(saved)
      assertEquals("en", catalog.language)
      assertEquals("Pause", catalog.t("Pause"))
    }
  }
}
