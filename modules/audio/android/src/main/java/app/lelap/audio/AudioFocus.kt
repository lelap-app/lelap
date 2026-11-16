package app.lelap.audio

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.audio.AudioFocusRequestCompat
import androidx.media3.common.audio.AudioManagerCompat

enum class FocusAction { PAUSE, PAUSE_TRANSIENT, DUCK, RESTORE }

fun focusAction(focusChange: Int, duckOnInterruption: Boolean): FocusAction = when (focusChange) {
  AudioManager.AUDIOFOCUS_LOSS -> FocusAction.PAUSE
  AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ->
    if (duckOnInterruption) FocusAction.DUCK else FocusAction.PAUSE_TRANSIENT
  AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> FocusAction.DUCK
  else -> FocusAction.RESTORE
}

/**
 * Audio focus handled by us instead of ExoPlayer, which pauses on calls and on every duck request
 * for spoken audio. Calls and VoIP arrive as transient loss, so ducking them is our policy.
 */
class AudioFocus(context: Context, private val onAction: (FocusAction) -> Unit) {
  var duckOnInterruption = true

  private val audioManager = AudioManagerCompat.getAudioManager(context)
  private var held = false

  private val request = AudioFocusRequestCompat.Builder(AudioManagerCompat.AUDIOFOCUS_GAIN)
    .setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
        .build(),
    )
    // Stops the system from ducking for us, so the duck level stays ours.
    .setWillPauseWhenDucked(true)
    .setOnAudioFocusChangeListener(
      { change -> onAction(focusAction(change, duckOnInterruption)) },
      Handler(Looper.getMainLooper()),
    )
    .build()

  fun request(): Boolean {
    if (held) return true
    held = AudioManagerCompat.requestAudioFocus(audioManager, request) ==
      AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    return held
  }

  fun abandon() {
    if (!held) return
    AudioManagerCompat.abandonAudioFocusRequest(audioManager, request)
    held = false
  }
}
