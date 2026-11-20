package app.lelap.audio

import android.app.Activity
import android.app.SearchManager
import android.content.Intent
import android.os.Bundle
import android.util.Log

/**
 * The Assistant's “play X on Lelap” on the phone (M147) arrives as `MEDIA_PLAY_FROM_SEARCH`.
 * Nothing is shown: the request goes to [PlaybackService], which answers it as it answers
 * Android Auto, and the activity is gone at once.
 */
class VoiceSearchActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val request = Intent(this, PlaybackService::class.java)
      .setAction(PLAY_FROM_SEARCH)
      .putExtra(SearchManager.QUERY, intent?.getStringExtra(SearchManager.QUERY).orEmpty())
    intent?.extras?.let { request.putExtra(EXTRAS, it) }
    try {
      // Allowed while this activity is in front; the service goes to the foreground once it plays.
      startService(request)
    } catch (e: IllegalStateException) {
      Log.w("LelapVoice", "Could not reach the player: ${e.message}")
    }
    finish()
  }

  companion object {
    const val PLAY_FROM_SEARCH = "app.lelap.audio.PLAY_FROM_SEARCH"
    const val EXTRAS = "app.lelap.audio.SEARCH_EXTRAS"
  }
}
