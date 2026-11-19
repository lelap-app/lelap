import { chooseEpisodeFile } from '@lelap/core';
import { addNetworkStateListener, getNetworkStateAsync, NetworkStateType } from 'expo-network';
import { Platform } from 'react-native';

import { db } from './db';
import { profileId } from './profile';

// Browsers don't say reliably whether a connection is metered, so the web counts as unmetered.
let metered = false;

if (Platform.OS !== 'web') {
  const note = (type: NetworkStateType | undefined) => {
    metered = type === NetworkStateType.CELLULAR;
  };
  void getNetworkStateAsync()
    .then((state) => note(state.type))
    .catch(() => {});
  addNetworkStateListener((state) => note(state.type));
}

/** Whether the phone is on mobile data now. */
export const onMobileData = (): boolean => metered;

/**
 * Points an episode's book at the file its show's choice calls for (M103): automatic plays the
 * feed's own file, and the smallest alternate on mobile data. Other books are left alone.
 */
export function pickEpisodeFile(bookId: string, mobileData = metered): boolean {
  return chooseEpisodeFile(db, profileId, bookId, mobileData, Date.now());
}
