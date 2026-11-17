import type { Settings } from '@lelap/core';

import * as audio from './platform/audio';

/** Hands the bedtime setting to the player service, which starts the timer by itself. */
export function applyBedtime(settings: Settings): Promise<void> {
  return audio
    .setBedtime(
      settings.bedtimeTimer
        ? {
            startMinute: settings.bedtimeStart,
            endMinute: settings.bedtimeEnd,
            chapter: settings.bedtimeChapter,
            minutes: settings.bedtimeMinutes,
          }
        : null,
    )
    .catch(() => {});
}
