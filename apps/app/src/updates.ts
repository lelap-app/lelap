import { getSettings, pickUpdate, ReleaseInfo } from '@lelap/core';
import { Alert } from 'react-native';

import { downloadsBase } from './config';
import { db } from './db';
import * as updater from './platform/updater';
import { profileId } from './profile';

async function fetchRelease(name: 'latest' | 'beta'): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(`${downloadsBase}/${name}.json`, { cache: 'no-store' });
    if (!response.ok) return null;
    const parsed = ReleaseInfo.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The release to offer this device, or null when it is up to date. */
export async function checkForUpdate(): Promise<ReleaseInfo | null> {
  if (!updater.SELF_UPDATES) return null;
  const beta = getSettings(db, profileId).betaUpdates;
  const [stable, betaRelease] = await Promise.all([
    fetchRelease('latest'),
    beta ? fetchRelease('beta') : Promise.resolve(null),
  ]);
  return pickUpdate(updater.versionCode(), beta ? 'beta' : 'stable', stable, betaRelease);
}

/** Installs a release, first sending the user to Android's permission if needed. */
export async function installUpdate(release: ReleaseInfo): Promise<void> {
  if (!updater.canInstall()) {
    Alert.alert(
      'Allow updates',
      'Android asks once before an app may install its own updates. Turn on “Allow from this source” for Lelap, then come back and install.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => void updater.openInstallSettings() },
      ],
    );
    return;
  }
  await updater.install(release.url, release.sha256, release.size);
}

let offered = false;

/** Once per start: offer a new release if there is one. */
export async function offerUpdateOnStart(): Promise<void> {
  if (offered) return;
  offered = true;
  const release = await checkForUpdate();
  if (!release) return;
  Alert.alert(`Lelap ${release.version} is available`, undefined, [
    { text: 'Later', style: 'cancel' },
    { text: 'Install', onPress: () => void installUpdate(release).catch(() => {}) },
  ]);
}
