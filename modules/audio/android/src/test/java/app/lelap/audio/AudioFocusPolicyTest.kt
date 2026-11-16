package app.lelap.audio

import android.media.AudioManager
import org.junit.Assert.assertEquals
import org.junit.Test

class AudioFocusPolicyTest {
  @Test fun permanentLossPauses() {
    assertEquals(FocusAction.PAUSE, focusAction(AudioManager.AUDIOFOCUS_LOSS, true))
    assertEquals(FocusAction.PAUSE, focusAction(AudioManager.AUDIOFOCUS_LOSS, false))
  }

  @Test fun transientLossDucksOnlyWhenEnabled() {
    assertEquals(FocusAction.DUCK, focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, true))
    assertEquals(FocusAction.PAUSE_TRANSIENT, focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, false))
  }

  @Test fun canDuckAlwaysDucks() {
    assertEquals(FocusAction.DUCK, focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK, true))
    assertEquals(FocusAction.DUCK, focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK, false))
  }

  @Test fun gainRestores() {
    assertEquals(FocusAction.RESTORE, focusAction(AudioManager.AUDIOFOCUS_GAIN, true))
    assertEquals(FocusAction.RESTORE, focusAction(AudioManager.AUDIOFOCUS_GAIN, false))
  }
}
