package app.lelap.widget

import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import java.util.concurrent.Executor

/** Sends one command to `modules/audio`'s PlaybackService through a short-lived MediaController. */
object PlayerRemote {
  enum class Action { PLAY_PAUSE, BACK, FORWARD }

  // By name, so this module needs no compile-time link to modules/audio.
  private const val PLAYBACK_SERVICE = "app.lelap.audio.PlaybackService"
  // Lets the command reach the session before the controller disconnects.
  private const val RELEASE_DELAY_MS = 1_000L

  private val main = Handler(Looper.getMainLooper())
  private val mainExecutor = Executor { main.post(it) }

  fun send(context: Context, action: Action, done: () -> Unit = {}) {
    val app = context.applicationContext
    val token = SessionToken(app, ComponentName(app.packageName, PLAYBACK_SERVICE))
    val future = MediaController.Builder(app, token).buildAsync()
    future.addListener({
      val controller = runCatching { future.get() }.getOrNull()
      if (controller == null) {
        done()
        return@addListener
      }
      runCatching { perform(controller, action) }
      main.postDelayed({
        controller.release()
        done()
      }, RELEASE_DELAY_MS)
    }, mainExecutor)
  }

  private fun perform(player: Player, action: Action) {
    when (action) {
      Action.PLAY_PAUSE ->
        if (player.playWhenReady && player.playbackState != Player.STATE_ENDED) {
          player.pause()
        } else {
          // With nothing loaded (the app was closed), Play makes the session resume the last book.
          if (player.playbackState == Player.STATE_IDLE && player.mediaItemCount > 0) player.prepare()
          player.play()
        }
      Action.BACK -> player.seekBack()
      Action.FORWARD -> player.seekForward()
    }
  }
}
