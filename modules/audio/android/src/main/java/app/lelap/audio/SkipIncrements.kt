package app.lelap.audio

import androidx.media3.common.Player

/**
 * The listeners of the session's player, told when the skip interval changes. Our increments
 * replace ExoPlayer's, which never reports them changing, so connected controllers (the app, a
 * watch, a car) would keep the old one.
 */
class SkipIncrements {
  private val listeners = mutableListOf<Player.Listener>()

  fun add(listener: Player.Listener) {
    if (listener !in listeners) listeners += listener
  }

  fun remove(listener: Player.Listener) {
    listeners -= listener
  }

  fun announce(intervalMs: Long) {
    for (listener in listeners.toList()) {
      listener.onSeekBackIncrementChanged(intervalMs)
      listener.onSeekForwardIncrementChanged(intervalMs)
    }
  }
}
