import { addonSourceHosts, bundledAddon, bundledAddons, listAddons } from '@lelap/core';
import { LibraryResponse, type Manifest, offersLibrary, type Settings } from '@lelap/sdk';

import { db } from './db';
import { t } from './i18n';
import { callAddonLibrary } from './sandbox';

// Add-ons inside the app used as library sources (M57): bundled ones, which show as kinds in
// “Add a server”, and installed ones that list a library.

export type SourceKind = { url: string; manifest: Manifest; bundled: boolean };

/** The add-ons “Add a server” offers next to WebDAV and S3: bundled first, then installed. */
export function libraryKinds(): SourceKind[] {
  const bundled = bundledAddons().map((a) => ({ url: a.url, manifest: a.manifest, bundled: true }));
  const installed = listAddons(db)
    .filter((a) => offersLibrary(a.manifest) && !bundledAddon(a.url))
    .map((a) => ({ url: a.url, manifest: a.manifest, bundled: false }));
  return [...bundled, ...installed];
}

/** An add-on's manifest, bundled or installed; null when it is no longer on this device. */
export function sourceManifest(addonUrl: string): Manifest | null {
  return (
    bundledAddon(addonUrl)?.manifest ??
    listAddons(db).find((a) => a.url === addonUrl)?.manifest ??
    null
  );
}

/** The hosts an add-on inside the app declares; null for one that is not on this device. */
export function declaredHosts(addonUrl: string): string[] | null {
  return sourceManifest(addonUrl)?.sandbox?.hosts ?? null;
}

/**
 * One server's library, from its add-on, in a sandbox that reaches only the add-on's hosts and
 * the addresses in `settings`. `sandboxId` keeps servers apart; a server not yet added uses one
 * of its own.
 */
export async function listAddonLibrary(args: {
  addonUrl: string;
  manifest: Manifest;
  sandboxId: string;
  settings: Settings;
}): Promise<LibraryResponse> {
  const { status, body } = await callAddonLibrary({
    addonUrl: args.addonUrl,
    sandboxId: args.sandboxId,
    hosts: addonSourceHosts(args.manifest, args.settings),
    settings: args.settings,
  });
  if (status !== 200) {
    const said =
      typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : null;
    throw new Error(said ?? t('The add-on answered {status}.', { status }));
  }
  const parsed = LibraryResponse.safeParse(body);
  if (!parsed.success) throw new Error(t('The add-on’s list of files is not valid.'));
  return parsed.data;
}
