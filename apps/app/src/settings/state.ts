import { getSettings, type Settings, setSetting } from '@lelap/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import * as audio from '../platform/audio';
import { applyBedtime } from '../bedtime';
import { db } from '../db';
import { allowDevices, followDevices } from '../devices';
import { applyRules } from '../downloads';
import { setLanguage } from '../i18n';
import { useLibrary } from '../player';
import { profileId } from '../profile';
import { setLook } from '../theme';

export type UpdateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

/**
 * This profile's settings, read again whenever the page comes back into view, and a setter that
 * tells the player, downloads and the rest of the app what changed.
 */
export function useSettingsState() {
  const { refresh } = useLibrary();
  const [settings, setSettings] = useState(() => getSettings(db, profileId));
  // A page opened from the list may have changed them.
  useFocusEffect(useCallback(() => setSettings(getSettings(db, profileId)), []));

  const update: UpdateSetting = (key, value) => {
    setSetting(db, profileId, key, value, Date.now());
    const next = getSettings(db, profileId);
    setSettings(next);
    void audio.setSettings(next);
    if (key === 'downloadOnWifiOnly' || key === 'downloadWhileChargingOnly') void applyRules(next);
    if (key.startsWith('bedtime')) void applyBedtime(next);
    if (key === 'headphoneBattery' || key === 'carModeOffer') void followDevices(next);
    if (key === 'language') setLanguage(next.language);
    if (key === 'theme' || key === 'accent' || key === 'customTheme') setLook(next);
    // Home, the Player and the list of shortcuts read these again on the library's signal.
    if (key === 'homeSuggestions' || key === 'badgesOnCovers' || key === 'skipIntervalMs') {
      refresh();
    }
  };

  // Both need “nearby devices”, asked for only when one is turned on.
  const updateDevices = async (key: 'headphoneBattery' | 'carModeOffer', value: boolean) => {
    if (value && !(await allowDevices())) return;
    update(key, value);
  };

  return { settings, update, updateDevices };
}
