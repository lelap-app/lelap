import { t } from './i18n';
import {
  bundledAddon,
  forgetStreamHeaders,
  getLocalAddonCode,
  installAddon,
  listRoots,
  localAddonUrl,
  saveLocalAddonCode,
} from '@lelap/core';
import { Manifest } from '@lelap/sdk';
import * as Crypto from 'expo-crypto';

import { reviewAddon } from './addonReview';
import { db, newId } from './db';
import { closeSandboxesOf, previewManifest } from './sandbox';

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
  const url = localAddonUrl(manifest.id);
  // A file can't take the place of an add-on that comes with the app, and with it its servers.
  if (bundledAddon(url)) throw new Error(t('An add-on with this ID comes with Lelap already.'));
  const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, code);
  const previous = getLocalAddonCode(db, url)?.sha256 ?? null;
  const servers = listRoots(db).filter(
    (r) => r.remote?.type === 'addon' && r.remote.addonUrl === url,
  ).length;
  const fingerprint = t('Code fingerprint {hash}…', { hash: sha256.slice(0, 16) });
  const accepted = await reviewAddon(
    manifest,
    url,
    t('Add'),
    servers > 0 && previous !== sha256
      ? `${fingerprint}\n${t('It replaces the add-on your servers use; they ask for their login again.')}`
      : fingerprint,
  );
  if (!accepted) return false;
  // Logins a stream of the old file asked for don't go to the new one.
  if (previous !== sha256) forgetStreamHeaders(db, url);
  saveLocalAddonCode(db, { url, sourceUrl, code, sha256, now: Date.now() });
  installAddon(db, { url, manifest, now: Date.now(), newId });
  // A running sandbox of an older version restarts with the new code.
  closeSandboxesOf(url);
  return true;
}
