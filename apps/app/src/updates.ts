import { t } from './i18n';
import { getSettings, pickUpdate, ReleaseInfo } from '@lelap/core';
import { Linking } from 'react-native';

import { showAlert } from './dialog';
import { downloadsBase, sourceUrl } from './config';
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
  return pickUpdate(
    updater.versionCode(),
    beta ? 'beta' : 'stable',
    stable,
    betaRelease,
    updater.pickAbi,
  );
}

/** Installs a release, first sending the user to Android's permission if needed. */
export async function installUpdate(release: ReleaseInfo): Promise<void> {
  if (!updater.canInstall()) {
    showAlert(
      t('Allow updates'),
      t(
        'Android asks once before an app may install its own updates. Turn on “Allow from this source” for Lelap, then come back and install.',
      ),
      [
        { text: t('Not now'), style: 'cancel' },
        { text: t('Open settings'), onPress: () => void updater.openInstallSettings() },
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
  showAlert(t('Lelap {version} is available', { version: release.version }), undefined, [
    { text: t('Later'), style: 'cancel' },
    { text: t('Install'), onPress: () => void installUpdate(release).catch(() => {}) },
  ]);
}

/**
 * Update for an add-on that needs a newer Lelap (M156): the in-app update on the direct APK, the
 * release page where the app can't update itself (F-Droid, the web).
 */
export async function updateLelap(): Promise<void> {
  if (!updater.SELF_UPDATES) {
    await Linking.openURL(`${sourceUrl}/releases`).catch(() => {});
    return;
  }
  const release = await checkForUpdate();
  if (release) {
    await installUpdate(release);
    return;
  }
  showAlert(
    t('Lelap is up to date.'),
    t('The add-on needs a version of Lelap that isn’t out yet. Try again in a few days.'),
  );
}
