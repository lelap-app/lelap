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

/** DELAYED: Android holds the request during a call and grants it when the call ends. */
enum class FocusResult { GRANTED, DELAYED, FAILED }

fun focusAction(focusChange: Int, interruption: Interruption): FocusAction = when (focusChange) {
  AudioManager.AUDIOFOCUS_LOSS -> FocusAction.PAUSE
  AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ->
    if (interruption == Interruption.DUCK) FocusAction.DUCK else FocusAction.PAUSE_TRANSIENT
  AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> FocusAction.DUCK
  else -> FocusAction.RESTORE
}

/**
 * Audio focus handled by us instead of ExoPlayer, which pauses on calls and on every duck request
 * for spoken audio. Calls and VoIP arrive as transient loss, so ducking them is our policy.
 */
class AudioFocus(context: Context, private val onAction: (FocusAction) -> Unit) {
  var interruption = Interruption.DUCK

  private val audioManager = AudioManagerCompat.getAudioManager(context)
  private enum class State { NONE, PENDING, HELD }

  private var state = State.NONE

  private val request = AudioFocusRequestCompat.Builder(AudioManagerCompat.AUDIOFOCUS_GAIN)
    .setAudioAttributes(
      AudioAttributes.Builder()
        .setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
        .build(),
    )
    // Stops the system from ducking for us, so the duck level stays ours.
    .setWillPauseWhenDucked(true)
    .setAcceptsDelayedFocusGain(true)
    .setOnAudioFocusChangeListener(
      { change ->
        if (change == AudioManager.AUDIOFOCUS_GAIN) state = State.HELD
        onAction(focusAction(change, interruption))
      },
      Handler(Looper.getMainLooper()),
    )
    .build()

  fun request(): FocusResult {
    when (state) {
      State.HELD -> return FocusResult.GRANTED
      State.PENDING -> return FocusResult.DELAYED
      State.NONE -> Unit
    }
    return when (AudioManagerCompat.requestAudioFocus(audioManager, request)) {
      AudioManager.AUDIOFOCUS_REQUEST_GRANTED -> FocusResult.GRANTED.also { state = State.HELD }
      AudioManager.AUDIOFOCUS_REQUEST_DELAYED -> FocusResult.DELAYED.also { state = State.PENDING }
      else -> FocusResult.FAILED
    }
  }

  fun abandon() {
    if (state == State.NONE) return
    AudioManagerCompat.abandonAudioFocusRequest(audioManager, request)
    state = State.NONE
  }
}
