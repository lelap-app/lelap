package app.lelap.audio

import app.lelap.text.NativeCatalog

/**
 * The sleep timer button on the notification and lock screen steps through these. [OTHER] is a
 * timer set in the app (any length, or end of episode); the next press turns it off.
 */
enum class SleepStep { OFF, MIN_15, MIN_30, CHAPTER, OTHER }

object SleepCycle {
  const val MIN_15_MS = 15 * 60_000L
  const val MIN_30_MS = 30 * 60_000L

  /** Where the cycle is: [pressed] is the step the button last started, if any. */
  fun current(active: Boolean, mode: SleepMode?, pressed: SleepStep?): SleepStep = when {
    !active || mode == null -> SleepStep.OFF
    pressed == SleepStep.CHAPTER && mode == SleepMode.CHAPTER -> SleepStep.CHAPTER
    (pressed == SleepStep.MIN_15 || pressed == SleepStep.MIN_30) && mode == SleepMode.MINUTES -> pressed
    else -> SleepStep.OTHER
  }

  fun next(step: SleepStep): SleepStep = when (step) {
    SleepStep.OFF -> SleepStep.MIN_15
    SleepStep.MIN_15 -> SleepStep.MIN_30
    SleepStep.MIN_30 -> SleepStep.CHAPTER
    SleepStep.CHAPTER, SleepStep.OTHER -> SleepStep.OFF
  }

  /** The button's accessible name, which says what is set now, in [text]'s language. */
  fun label(step: SleepStep, text: NativeCatalog = NativeCatalog.ENGLISH): String = when (step) {
    SleepStep.OFF -> text.t("Sleep timer off")
    SleepStep.MIN_15 -> text.t("Sleep timer 15 minutes")
    SleepStep.MIN_30 -> text.t("Sleep timer 30 minutes")
    SleepStep.CHAPTER -> text.t("Sleep timer end of chapter")
    SleepStep.OTHER -> text.t("Sleep timer on")
  }
}
