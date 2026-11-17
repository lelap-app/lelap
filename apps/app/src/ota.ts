// Over-the-air JavaScript updates (expo-updates, M18). The APK updater in `updates.ts` replaces
// the whole app; this only swaps the JavaScript bundle within one native build (runtime version).
import { getSettings } from '@lelap/core';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { distribution } from './config';
import { db } from './db';
import { profileId } from './profile';

/** False in development builds, the F-Droid build and builds without a code-signing certificate. */
export const OTA_UPDATES: boolean = Updates.isEnabled && !__DEV__ && distribution !== 'fdroid';

/** Resume checks wait this long after the last one. */
const RESUME_INTERVAL_MS = 30 * 60 * 1000;

export type OtaResult = 'none' | 'downloaded' | 'error';

/** Beta testers (the setting, or a beta APK) get the beta channel. */
function applyChannel(): void {
  const prerelease = (Constants.expoConfig?.version ?? '').includes('-');
  const beta = getSettings(db, profileId).betaUpdates || prerelease;
  try {
    Updates.setUpdateRequestHeadersOverride({ 'expo-channel-name': beta ? 'beta' : 'production' });
  } catch {
    // Not supported where updates are off; the build's channel stays.
  }
}

let running: Promise<OtaResult> | null = null;
let lastCheck = 0;

/** Downloads a newer bundle if there is one. It starts with the next cold start, never mid-play. */
export function fetchOtaUpdate(): Promise<OtaResult> {
  if (!OTA_UPDATES) return Promise.resolve('none');
  running ??= (async (): Promise<OtaResult> => {
    lastCheck = Date.now();
    try {
      applyChannel();
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return 'none';
      const fetched = await Updates.fetchUpdateAsync();
      return fetched.isNew ? 'downloaded' : 'none';
    } catch {
      return 'error';
    } finally {
      running = null;
    }
  })();
  return running;
}

/** A line for Settings: which bundle runs now. */
export function otaDescription(): string | null {
  if (!OTA_UPDATES) return null;
  if (Updates.isEmbeddedLaunch) return 'Running the version that came with this install.';
  const date = Updates.createdAt?.toLocaleDateString() ?? '';
  return `Running update ${Updates.updateId?.slice(0, 8) ?? '?'}${date ? ` from ${date}` : ''}.`;
}

/** Checks on start and when the app comes back, if the user allows it. */
export function OtaRunner(): null {
  useEffect(() => {
    if (!OTA_UPDATES) return;
    const run = () => {
      if (getSettings(db, profileId).otaUpdates) void fetchOtaUpdate();
    };
    run();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active' && Date.now() - lastCheck > RESUME_INTERVAL_MS) run();
    });
    return () => subscription.remove();
  }, []);
  return null;
}
