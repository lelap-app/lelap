import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { settings } from './schema';
import { getSettings, setSetting } from './settings';

describe('settings', () => {
  it('starts with the defaults', () => {
    expect(getSettings(createTestDb(), ME)).toEqual({
      duckOnInterruption: true,
      skipIntervalMs: 30_000,
      smartRewind: true,
      mono: false,
      voiceEq: false,
      volumeBoost: false,
      downloadOnWifiOnly: true,
      downloadWhileChargingOnly: false,
      betaUpdates: false,
      otaUpdates: true,
      yearlyGoalBooks: 0,
      bedtimeTimer: false,
      bedtimeStart: 1320,
      bedtimeEnd: 120,
      bedtimeChapter: false,
      bedtimeMinutes: 30,
      headphoneBattery: false,
      carModeOffer: false,
      language: 'en',
    });
  });

  it('keeps a written value', () => {
    const db = createTestDb();
    setSetting(db, ME, 'skipIntervalMs', 15_000, 1);
    setSetting(db, ME, 'skipIntervalMs', 45_000, 2);
    expect(getSettings(db, ME).skipIntervalMs).toBe(45_000);
  });

  it('falls back to the default for a corrupt value', () => {
    const db = createTestDb();
    db.insert(settings)
      .values({ profileId: ME, key: 'smartRewind', value: '"yes"', updatedAt: 1 })
      .run();
    expect(getSettings(db, ME).smartRewind).toBe(true);
  });
});
