package app.lelap.fold

/**
 * A hinge in window points: `Fold` in packages/core/src/screen.ts, which decides the layout. The
 * window it was measured in comes along (M120): React Native's own window size can arrive a frame
 * later, and the layout takes both from here.
 */
data class Hinge(
  val vertical: Boolean,
  val separating: Boolean,
  val start: Double,
  val end: Double,
  val windowWidth: Double,
  val windowHeight: Double,
)

object Folds {
  /**
   * The hinge from a folding feature's bounds in window pixels, or null when it doesn't cross the
   * window, as for a window on one half of the screen.
   */
  fun hinge(
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
    vertical: Boolean,
    separating: Boolean,
    windowWidth: Int,
    windowHeight: Int,
    density: Float,
  ): Hinge? {
    if (density <= 0f) return null
    val start = if (vertical) left else top
    val end = if (vertical) right else bottom
    val size = if (vertical) windowWidth else windowHeight
    if (end < start || start <= 0 || end >= size) return null
    val d = density.toDouble()
    return Hinge(vertical, separating, start / d, end / d, windowWidth / d, windowHeight / d)
  }

  fun toMap(hinge: Hinge): Map<String, Any> =
    mapOf(
      "orientation" to if (hinge.vertical) "vertical" else "horizontal",
      "separating" to hinge.separating,
      "start" to hinge.start,
      "end" to hinge.end,
      "window" to mapOf("width" to hinge.windowWidth, "height" to hinge.windowHeight),
    )
}
