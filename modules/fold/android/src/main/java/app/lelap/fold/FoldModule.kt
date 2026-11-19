package app.lelap.fold

import android.app.Activity
import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import androidx.window.layout.WindowMetricsCalculator
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CHANGE_EVENT = "onChange"

/**
 * Follows the hinge of a foldable through Jetpack WindowManager, for the activity on screen. A
 * phone or tablet without one reports no fold and never sends an event.
 */
class FoldModule : Module() {
  private var tracker: WindowInfoTrackerCallbackAdapter? = null
  private var activity: Activity? = null
  // Written on the main thread, read by `current()` on the JavaScript thread.
  @Volatile private var hinge: Hinge? = null
  private val listener = Consumer<WindowLayoutInfo> { info -> onLayout(info) }

  override fun definition() = ModuleDefinition {
    Name("LelapFold")
    Events(CHANGE_EVENT)

    Function("current") { hinge?.let(Folds::toMap) }

    AsyncFunction("start") { follow() }.runOnQueue(Queues.MAIN)

    // A new activity (after the app was in the background) needs its own listener.
    OnActivityEntersForeground { follow() }

    OnActivityDestroys { stop() }

    OnDestroy { stop() }
  }

  private fun follow() {
    val current = appContext.currentActivity ?: return
    if (current === activity) return
    stop()
    val adapter = WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(current))
    adapter.addWindowLayoutInfoListener(current, ContextCompat.getMainExecutor(current), listener)
    tracker = adapter
    activity = current
  }

  private fun stop() {
    tracker?.removeWindowLayoutInfoListener(listener)
    tracker = null
    activity = null
  }

  private fun onLayout(info: WindowLayoutInfo) {
    val current = activity ?: return
    val feature = info.displayFeatures.filterIsInstance<FoldingFeature>().firstOrNull()
    val window = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(current).bounds
    val next = feature?.let {
      Folds.hinge(
        it.bounds.left,
        it.bounds.top,
        it.bounds.right,
        it.bounds.bottom,
        vertical = it.orientation == FoldingFeature.Orientation.VERTICAL,
        separating = it.isSeparating,
        windowWidth = window.width(),
        windowHeight = window.height(),
        density = current.resources.displayMetrics.density,
      )
    }
    if (next == hinge) return
    hinge = next
    sendEvent(CHANGE_EVENT, mapOf("fold" to next?.let(Folds::toMap)))
  }
}
