import {
  addonSourceHosts,
  bundledAddon,
  bundledAddons,
  getLocalAddonCode,
  listAddons,
} from '@lelap/core';
import { LibraryResponse, type Manifest, offersLibrary, type Settings } from '@lelap/sdk';

import { db } from './db';
import { t } from './i18n';
import { callAddonLibrary, closeServerSandbox } from './sandbox';

// Add-ons inside the app used as library sources (M57): bundled ones, which show as kinds in
// “Add a server”, and installed ones that list a library.

export type SourceKind = { url: string; manifest: Manifest; bundled: boolean };

/** The add-ons “Add a server” offers next to WebDAV and S3: bundled first, then installed. */
export function libraryKinds(): SourceKind[] {
  // Bundled scrobblers (M61) are set up under Settings → Add-ons instead.
  const bundled = bundledAddons()
    .filter((a) => offersLibrary(a.manifest))
    .map((a) => ({ url: a.url, manifest: a.manifest, bundled: true }));
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

/**
 * The fingerprint of an installed add-on's file; null for a bundled one, which comes with the app
 * and is trusted as it is.
 */
export function codeFingerprint(addonUrl: string): string | null {
  if (bundledAddon(addonUrl)) return null;
  return getLocalAddonCode(db, addonUrl)?.sha256 ?? 'missing';
}

/** The hosts an add-on inside the app declares; null for one that is not on this device. */
export function declaredHosts(addonUrl: string): string[] | null {
  return sourceManifest(addonUrl)?.sandbox?.hosts ?? null;
}

/** Pages of one library the app asks for (revision 9 `next`) before it stops. */
const MAX_PAGES = 1000;
/** Files of one library, over all its pages; the rest are left out. */
const MAX_FILES = 200_000;

/**
 * One server's library, from its add-on, in a sandbox that reaches only the add-on's hosts and
 * the addresses in `settings`. `sandboxId` keeps servers apart; a server not yet added uses one
 * of its own. A listing in pages (revision 9) is asked page by page and joined; the logins come
 * from the first page. The sandbox closes once the listing is done.
 */
export async function listAddonLibrary(args: {
  addonUrl: string;
  manifest: Manifest;
  sandboxId: string;
  settings: Settings;
  /** Pages to ask for, such as 1 for a check of the login; all of them by default. */
  maxPages?: number;
}): Promise<LibraryResponse> {
  try {
    let first: LibraryResponse | null = null;
    const files: LibraryResponse['files'] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < Math.min(args.maxPages ?? MAX_PAGES, MAX_PAGES); page++) {
      const listing = await libraryPage(args, cursor);
      first ??= listing;
      files.push(...listing.files.slice(0, MAX_FILES - files.length));
      if (files.length >= MAX_FILES) break;
      // A cursor seen before would go round in circles.
      if (!listing.next || seen.has(listing.next)) break;
      seen.add(listing.next);
      cursor = listing.next;
    }
    if (!first) throw new Error(t('The add-on’s list of files is not valid.'));
    const joined: LibraryResponse = { ...first, files };
    delete joined.next;
    return joined;
  } finally {
    closeServerSandbox(args.addonUrl, args.sandboxId);
  }
}

async function libraryPage(
  args: { addonUrl: string; manifest: Manifest; sandboxId: string; settings: Settings },
  cursor: string | undefined,
): Promise<LibraryResponse> {
  const { status, body } = await callAddonLibrary({
    addonUrl: args.addonUrl,
    sandboxId: args.sandboxId,
    hosts: addonSourceHosts(args.manifest, args.settings),
    settings: args.settings,
    ...(cursor === undefined ? {} : { cursor }),
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
