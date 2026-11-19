import {
  DEFAULT_PROFILE_ID,
  getActiveProfile,
  getProfile,
  getSettings,
  type Profile,
  setActiveProfile,
} from '@lelap/core';

import { db } from './db';
import { loadLanguage, setLanguage } from './i18n';
import { syncNativeText } from './nativeText';
import { setLook } from './theme';

/**
 * The profile everything is read and saved for. A live binding: modules that import it see the
 * new value after a switch, and screens re-read when the library version changes.
 */
export let profileId: string = DEFAULT_PROFILE_ID;

/** Reads the profile this device used last; called once the database is open. */
export function loadActiveProfile(): void {
  profileId = getActiveProfile(db);
  const settings = getSettings(db, profileId);
  loadLanguage(settings.language);
  setLook(settings);
  syncNativeText();
}

export function setProfileId(id: string): void {
  profileId = id;
  setActiveProfile(db, id, Date.now());
  const settings = getSettings(db, id);
  setLanguage(settings.language);
  setLook(settings);
}

export const activeProfile = (): Profile | null => getProfile(db, profileId);
