package app.lelap.fold

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FoldsTest {
  @Test
  fun readsAVerticalHingeInPoints() {
    // A book-style foldable open half way: 2208 px wide at density 2.625, a 0 px seamless fold.
    val hinge = Folds.hinge(1104, 0, 1104, 1840, vertical = true, separating = true, 2208, 1840, 2.625f)
    assertEquals(
      Hinge(true, true, 1104 / 2.625, 1104 / 2.625, 2208 / 2.625, 1840 / 2.625),
      hinge,
    )
  }

  @Test
  fun readsAHorizontalHingeAcrossTheHeight() {
    val hinge = Folds.hinge(0, 1000, 1080, 1060, vertical = false, separating = true, 1080, 2400, 2f)
    assertEquals(Hinge(false, true, 500.0, 530.0, 540.0, 1200.0), hinge)
  }

  @Test
  fun ignoresAHingeOutsideTheWindow() {
    // A window on one half of the screen touches the hinge only at its edge.
    assertNull(Folds.hinge(0, 0, 0, 1840, vertical = true, separating = true, 1104, 1840, 2.625f))
    assertNull(Folds.hinge(1104, 0, 1104, 1840, vertical = true, separating = true, 1104, 1840, 2.625f))
    assertNull(Folds.hinge(10, 0, 5, 100, vertical = true, separating = false, 100, 100, 1f))
    assertNull(Folds.hinge(50, 0, 50, 100, vertical = true, separating = false, 100, 100, 0f))
  }

  @Test
  fun aNewWindowSizeIsANewHinge() {
    // The same hinge in a resized window is sent again, so the layout follows both together.
    val before = Folds.hinge(0, 1000, 1080, 1060, vertical = false, separating = true, 1080, 2400, 2f)
    val after = Folds.hinge(0, 1000, 1080, 1060, vertical = false, separating = true, 1080, 2200, 2f)
    assert(before != after)
  }

  @Test
  fun mapsForJavaScript() {
    val map = Folds.toMap(Hinge(false, false, 400.0, 400.0, 800.0, 900.0))
    assertEquals(
      mapOf(
        "orientation" to "horizontal",
        "separating" to false,
        "start" to 400.0,
        "end" to 400.0,
        "window" to mapOf("width" to 800.0, "height" to 900.0),
      ),
      map,
    )
  }
}
