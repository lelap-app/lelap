import {
  exportLibrary,
  fetchManifest,
  importLibrary,
  installAddon,
  parseBackup,
} from '@lelap/core';
import * as DocumentPicker from 'expo-document-picker';

import { fetcher } from './addons';
import { db, newId } from './db';
import { showAlert } from './dialog';
import { readPickedText, shareText } from './platform/files';

/** Saves everything on this device as one JSON file, through the share sheet or a download. */
export async function exportBackup(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await shareText(`lelap-library-${day}.json`, JSON.stringify(exportLibrary(db, Date.now())));
}

async function addAddons(urls: string[]): Promise<number> {
  let added = 0;
  for (const url of urls) {
    try {
      const manifest = await fetchManifest(fetcher, url);
      installAddon(db, { url, manifest, now: Date.now(), newId });
      added += 1;
    } catch {
      // An add-on that is gone or offline is left out; the rest of the import stands.
    }
  }
  return added;
}

/**
 * Merges an export into this device. Add-ons from the file are offered, not installed silently:
 * they are run by others. `canAddAddons` is false for a kids profile.
 */
export async function importBackup(canAddAddons: boolean, done: () => void): Promise<void> {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    type: ['application/json', 'text/plain', '*/*'],
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return;
  const backup = parseBackup(await readPickedText(asset));
  const result = importLibrary(db, backup, Date.now(), newId);
  done();
  const summary = `${result.changes} changes merged. Places, lists and tags that were newer here stayed.`;
  if (!canAddAddons || result.addons.length === 0) {
    showAlert('Library imported', summary);
    return;
  }
  showAlert(
    'Library imported',
    `${summary}\n\nThe file also lists ${result.addons.length} add-on${result.addons.length === 1 ? '' : 's'} you don't have here. Add-ons are run by their authors, not by Lelap.\n\n${result.addons.join('\n')}`,
    [
      { text: 'Skip', style: 'cancel' },
      {
        text: 'Add them',
        onPress: () =>
          void addAddons(result.addons).then((added) => {
            done();
            showAlert(`${added} of ${result.addons.length} add-ons added`);
          }),
      },
    ],
  );
}
