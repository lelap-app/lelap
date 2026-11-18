import type { Settings } from '@lelap/core';

import * as audio from './platform/audio';

/**
 * Hands the profile's bedtime routine to the player service, which starts the timer and the
 * quieter volume by itself. Called at start and on every profile switch, so the routine is always
 * the listening profile's own.
 */
export function applyBedtime(settings: Settings): Promise<void> {
  return audio
    .setBedtime(
      settings.bedtimeTimer
        ? {
            startMinute: settings.bedtimeStart,
            endMinute: settings.bedtimeEnd,
            chapter: settings.bedtimeChapter,
            minutes: settings.bedtimeMinutes,
            volume: settings.bedtimeVolume,
          }
        : null,
    )
    .catch(() => {});
}
