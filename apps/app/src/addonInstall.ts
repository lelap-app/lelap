import { t } from './i18n';
import { fetchManifest, findAddonById, installAddon, replaceAddonUrl } from '@lelap/core';
import { type Manifest, needsConfiguration } from '@lelap/sdk';
import { Linking } from 'react-native';

import { configurePageUrl, fetcher } from './addons';
import { isOwnAddon } from './config';
import { db, newId } from './db';
import { reviewAddon } from './addonReview';
import { showAlert } from './dialog';

// Our own add-ons say so; anyone else's gets the reminder to trust its author.
const trust = (url: string) =>
  isOwnAddon(url)
    ? t('This add-on is made by Lelap.')
    : t('Add-ons are run by their authors, not by Lelap. Only add ones you trust.');

const host = (url: string) => /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url;

/** `https://host:port` of a web add-on; null for anything else, such as an in-app add-on. */
const webOrigin = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
};

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
      text: t('Cancel'),
      style: 'cancel' as const,
      onPress: () => resolve('cancelled'),
    };
    // Tapping outside an Android dialog presses no button.
    const options = { cancelable: true, onDismiss: () => resolve('cancelled') };
    if (needsConfiguration(manifest)) {
      showAlert(
        t('{name} needs settings', { name: manifest.name }),
        `${t('Set it up on its own page, then come back to Lelap.')}\n\n${trust(manifestUrl)}`,
        [
          cancel,
          {
            text: t('Configure'),
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
    // A manifest can claim any ID. Only the same server may move an add-on, with its books and
    // unsent scrobbles, to a new address; a link from anywhere else must not take it over.
    const from = existing ? webOrigin(existing.url) : null;
    if (existing && existing.url !== manifestUrl && (!from || from !== webOrigin(manifestUrl))) {
      showAlert(
        t('{name} is added already', { name: existing.manifest.name }),
        from
          ? t('It comes from {host}. Remove it first to add the one from {other}.', {
              host: host(existing.url),
              other: host(manifestUrl),
            })
          : t('It runs on this device. Remove it first to add the one from {other}.', {
              other: host(manifestUrl),
            }),
        [{ text: t('OK'), onPress: () => resolve('cancelled') }],
        options,
      );
      return;
    }
    if (existing && existing.url !== manifestUrl) {
      showAlert(
        t('Update {name}?', { name: manifest.name }),
        `${t('Lelap will use the new settings from {host}. Books you play from it stay in your library.', { host: host(manifestUrl) })}\n\n${trust(manifestUrl)}`,
        [
          cancel,
          {
            text: t('Update'),
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
    void reviewAddon(manifest, manifestUrl, existing ? t('Refresh') : t('Add')).then((accepted) => {
      if (!accepted) {
        resolve('cancelled');
        return;
      }
      installAddon(db, { url: manifestUrl, manifest, now: Date.now(), newId });
      resolve('added');
    });
  });
}
