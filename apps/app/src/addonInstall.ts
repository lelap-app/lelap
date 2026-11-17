import { fetchManifest, findAddonById, installAddon, replaceAddonUrl } from '@lelap/core';
import { type Manifest, needsConfiguration } from '@lelap/sdk';
import { Linking } from 'react-native';

import { configurePageUrl, fetcher } from './addons';
import { db, newId } from './db';
import { showAlert } from './dialog';

const TRUST = 'Add-ons are run by their authors, not by Lelap. Only add ones you trust.';

const host = (url: string) => /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url;

/** Opens the add-on's configure page in the browser. */
export function openConfigure(manifestUrl: string): void {
  void Linking.openURL(configurePageUrl(manifestUrl));
}

/**
 * Fetches a manifest and asks before installing it. A manifest whose add-on is already installed
 * under another URL (new settings from its configure page) replaces that URL instead; one that
 * still needs settings opens its configure page. Resolves once the listener has chosen.
 */
export async function confirmAddon(manifestUrl: string): Promise<'added' | 'cancelled'> {
  const manifest: Manifest = await fetchManifest(fetcher, manifestUrl);
  return new Promise((resolve) => {
    const cancel = {
      text: 'Cancel',
      style: 'cancel' as const,
      onPress: () => resolve('cancelled'),
    };
    // Tapping outside an Android dialog presses no button.
    const options = { cancelable: true, onDismiss: () => resolve('cancelled') };
    if (needsConfiguration(manifest)) {
      showAlert(
        `${manifest.name} needs settings`,
        `Set it up on its own page, then come back to Lelap.\n\n${TRUST}`,
        [
          cancel,
          {
            text: 'Configure',
            onPress: () => {
              openConfigure(manifestUrl);
              resolve('cancelled');
            },
          },
        ],
        options,
      );
      return;
    }
    const existing = findAddonById(db, manifest.id);
    if (existing && existing.url !== manifestUrl) {
      showAlert(
        `Update ${manifest.name}?`,
        `Lelap will use the new settings from ${host(manifestUrl)}. Books you play from it stay in your library.\n\n${TRUST}`,
        [
          cancel,
          {
            text: 'Update',
            onPress: () => {
              replaceAddonUrl(db, {
                oldUrl: existing.url,
                newUrl: manifestUrl,
                manifest,
                now: Date.now(),
              });
              resolve('added');
            },
          },
        ],
        options,
      );
      return;
    }
    showAlert(
      `Add ${manifest.name}?`,
      `${manifest.description}\n\n${TRUST}`,
      [
        cancel,
        {
          text: existing ? 'Refresh' : 'Add',
          onPress: () => {
            installAddon(db, { url: manifestUrl, manifest, now: Date.now(), newId });
            resolve('added');
          },
        },
      ],
      options,
    );
  });
}
