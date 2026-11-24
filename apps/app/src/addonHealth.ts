import { deviceValue, HealthTracker, parseHealth, setDeviceValue } from '@lelap/core';

import { db } from './db';
import { logAddonFailure } from './diagnostics';

/**
 * What each add-on's requests and scrobble posts did, for Settings → Library and sources →
 * Add-ons. Kept on this device across starts (M159); its own module, so the scrobbler can count
 * its posts without importing the add-on client.
 */
export const addonHealth = new HealthTracker(logAddonFailure);

const HEALTH_KEY = 'addonHealth';
// Requests come in bursts as a screen opens: one write for the burst, not one per request.
const WRITE_AFTER_MS = 2_000;
let pending: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

addonHealth.attach({
  read: () => parseHealth(deviceValue(db, HEALTH_KEY)),
  write: (all) => {
    pending = JSON.stringify(all);
    timer ??= setTimeout(() => {
      timer = null;
      const value = pending;
      pending = null;
      if (value === null) return;
      try {
        setDeviceValue(db, HEALTH_KEY, value, Date.now());
      } catch {
        // The next change writes it again.
      }
    }, WRITE_AFTER_MS);
  },
});
