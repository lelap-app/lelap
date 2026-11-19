import {
  addonLocateRequest,
  addonSettings,
  addonSourceHosts,
  getBook,
  listRoots,
  locatedAddresses,
  sameAddonCode,
} from '@lelap/core';
import { LocateResponse, offersLocate } from '@lelap/sdk';

import { codeFingerprint, sourceManifest } from './addonSources';
import { db } from './db';
import { callAddonLocate } from './sandbox';

// Before a book streams from an add-on server that locates its files (revision 11, M100), the
// add-on says where they are now: a Plex server's address away from home once the one at home
// stops answering, and none where another server answers there. File addresses otherwise stay
// those of the last scan. The answer is kept for this run of the app only. A book the playback
// service starts by itself, a download, and a book started with the app closed ask too (M123).

/** A minute: a book picked again soon after, or the next one of the same server, asks no more. */
const FRESH_MS = 60_000;

const located = new Map<string, string | null>();
const askedAt = new Map<string, number>();

const keyOf = (rootId: string, uri: string) => `${rootId}\n${uri}`;

/**
 * Where a file of an add-on server streams from now: a new address, null to stream it without
 * the login, or undefined when the add-on wasn't asked.
 */
export function locatedUri(rootId: string, uri: string): string | null | undefined {
  return located.get(keyOf(rootId, uri));
}

type Part = { rootId: string | null; downloadPath?: string | null };

/** The add-on server that locates the files still streamed, with what it needs to ask it. */
function locator<T extends Part>(all: T[]) {
  const files = all.filter((f) => !f.downloadPath);
  const rootId = files[0]?.rootId;
  if (!rootId || files.some((f) => f.rootId !== rootId)) return null;
  const root = listRoots(db).find((r) => r.id === rootId);
  const remote = root?.remote;
  if (!root || remote?.type !== 'addon' || root.needsLogin) return null;
  if (!sameAddonCode(remote, codeFingerprint(remote.addonUrl))) return null;
  const manifest = sourceManifest(remote.addonUrl);
  if (!manifest || !offersLocate(manifest)) return null;
  return { files, rootId, root, remote, manifest };
}

/**
 * Whether a book streams from an add-on server that locates its files, so the playback service
 * asks the app to locate them when it starts the book by itself (M123).
 */
export const locatesFiles = (files: Part[]): boolean => locator(files) !== null;

/** Asks the book's add-on where its files are, when it offers that; never throws. */
export async function locateAddonBook(bookId: string, profile: string): Promise<void> {
  const found = locator(getBook(db, profile, bookId)?.files ?? []);
  if (!found) return;
  const { files, rootId, root, remote, manifest } = found;
  const request = addonLocateRequest(root.location, files);
  if (!request) return;
  const now = Date.now();
  if (request.files.every((f) => now - (askedAt.get(keyOf(rootId, f.url)) ?? 0) < FRESH_MS)) {
    return;
  }
  const hosts = addonSourceHosts(manifest, remote.settings);
  try {
    const { status, body } = await callAddonLocate({
      addonUrl: remote.addonUrl,
      sandboxId: root.id,
      hosts,
      settings: addonSettings(remote),
      locate: request,
    });
    const parsed = LocateResponse.safeParse(body);
    if (status === 200 && parsed.success) {
      for (const [uri, to] of locatedAddresses(request, parsed.data, hosts)) {
        located.set(keyOf(rootId, uri), to);
        askedAt.set(keyOf(rootId, uri), now);
      }
      return;
    }
  } catch {
    // Offline, or the add-on gave up: below.
  }
  // The addresses of the last scan, as before, and no waiting again for a minute.
  for (const file of request.files) {
    located.delete(keyOf(rootId, file.url));
    askedAt.set(keyOf(rootId, file.url), now);
  }
}

/** Forgets what a server's add-on said, such as after a scan gave its files new addresses. */
export function forgetLocated(rootId: string): void {
  const prefix = `${rootId}\n`;
  for (const key of [...located.keys()]) {
    if (key.startsWith(prefix)) {
      located.delete(key);
      askedAt.delete(key);
    }
  }
}
