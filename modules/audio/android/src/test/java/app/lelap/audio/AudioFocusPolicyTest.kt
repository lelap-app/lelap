package app.lelap.audio

import android.media.AudioManager
import org.junit.Assert.assertEquals
import org.junit.Test

class AudioFocusPolicyTest {
  @Test fun permanentLossPauses() {
    assertEquals(FocusAction.PAUSE, focusAction(AudioManager.AUDIOFOCUS_LOSS, Interruption.DUCK))
    assertEquals(FocusAction.PAUSE, focusAction(AudioManager.AUDIOFOCUS_LOSS, Interruption.PAUSE))
  }

  @Test fun transientLossDucksOnlyInDuckMode() {
    assertEquals(FocusAction.DUCK, focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, Interruption.DUCK))
    assertEquals(FocusAction.PAUSE_TRANSIENT, focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, Interruption.PAUSE))
  }

  @Test fun canDuckAlwaysDucks() {
    assertEquals(FocusAction.DUCK, focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK, Interruption.DUCK))
    assertEquals(FocusAction.DUCK, focusAction(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK, Interruption.PAUSE))
  }

  @Test fun gainRestores() {
    assertEquals(FocusAction.RESTORE, focusAction(AudioManager.AUDIOFOCUS_GAIN, Interruption.DUCK))
    assertEquals(FocusAction.RESTORE, focusAction(AudioManager.AUDIOFOCUS_GAIN, Interruption.PAUSE))
  }
}
