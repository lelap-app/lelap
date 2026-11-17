import { t } from './i18n';
import { installAddon, localAddonUrl, saveLocalAddonCode } from '@lelap/core';
import { Manifest } from '@lelap/sdk';
import * as Crypto from 'expo-crypto';

import { reviewAddon } from './addonReview';
import { db, newId } from './db';
import { closeSandbox, previewManifest } from './sandbox';

const MAX_CODE_CHARS = 1_000_000;

/** A link to an in-app add-on's file rather than a manifest. */
export const isAddonFile = (url: string) => /\.m?js(\?.*)?$/i.test(url.trim());

/**
 * Installs an add-on that runs inside the app: fetches its one file, reads its manifest in a
 * sandbox with no network, shows what it can do and which hosts it may reach, and keeps the code
 * on this device. Resolves false when the listener cancels.
 */
export async function installAddonFile(sourceUrl: string): Promise<boolean> {
  const response = await fetch(sourceUrl, { credentials: 'omit' });
  if (!response.ok)
    throw new Error(t('The file could not be loaded ({status}).', { status: response.status }));
  const code = await response.text();
  if (code.length > MAX_CODE_CHARS) throw new Error(t('The file is too large for an add-on.'));
  const parsed = Manifest.safeParse(await previewManifest(code));
  if (!parsed.success) throw new Error(t('The file’s manifest is not valid.'));
  const manifest = parsed.data;
  if (!manifest.sandbox) {
    throw new Error(t('This file is not an in-app add-on: its manifest has no `sandbox` hosts.'));
  }
  const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, code);
  const url = localAddonUrl(manifest.id);
  const accepted = await reviewAddon(
    manifest,
    url,
    t('Add'),
    t('Code fingerprint {hash}…', { hash: sha256.slice(0, 16) }),
  );
  if (!accepted) return false;
  saveLocalAddonCode(db, { url, sourceUrl, code, sha256, now: Date.now() });
  installAddon(db, { url, manifest, now: Date.now(), newId });
  // A running sandbox of an older version restarts with the new code.
  closeSandbox(url);
  return true;
}
