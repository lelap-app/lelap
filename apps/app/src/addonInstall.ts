import { t } from './i18n';
import {
  asksForMore,
  fetchManifest,
  findAddonById,
  installAddon,
  replaceAddonUrl,
} from '@lelap/core';
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
 * still needs settings opens its configure page. `typed`: the listener entered the address in the
 * app, so a web add-on may also move to another server. Resolves once the listener has chosen;
 * `onFetched` is called once the manifest is in, before the question, so a screen waiting on the
 * fetch can stop its spinner and timeout there (M149).
 */
export async function confirmAddon(
  manifestUrl: string,
  typed = false,
  onFetched?: () => void,
): Promise<'added' | 'cancelled'> {
  const manifest: Manifest = await fetchManifest(fetcher, manifestUrl);
  onFetched?.();
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
    const move = (existing: { url: string }, action: string) =>
      void reviewAddon(manifest, manifestUrl, action).then((accepted) => {
        if (accepted) {
          replaceAddonUrl(db, {
            oldUrl: existing.url,
            newUrl: manifestUrl,
            manifest,
            now: Date.now(),
          });
        }
        resolve(accepted ? 'added' : 'cancelled');
      });
    const existing = findAddonById(db, manifest.id);
    // A manifest can claim any ID. Only the same server may move an add-on, with its books and
    // unsent scrobbles, to a new address; a link from anywhere else must not take it over. The
    // listener may move a web add-on to another server by entering its address here.
    const from = existing ? webOrigin(existing.url) : null;
    if (
      existing &&
      existing.url !== manifestUrl &&
      from &&
      typed &&
      webOrigin(manifestUrl) &&
      from !== webOrigin(manifestUrl)
    ) {
      showAlert(
        t('Move {name}?', { name: existing.manifest.name }),
        `${t('It comes from {host}. Lelap will use {other} instead; books you play from it stay in your library.', { host: host(existing.url), other: host(manifestUrl) })}\n\n${trust(manifestUrl)}`,
        [cancel, { text: t('Move'), onPress: () => move(existing, t('Move')) }],
        options,
      );
      return;
    }
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
    if (
      existing &&
      existing.url !== manifestUrl &&
      asksForMore(existing, { manifest, url: manifestUrl })
    ) {
      // New settings that also ask for more, such as listening history: the full sheet.
      move(existing, t('Update'));
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
