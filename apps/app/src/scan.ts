import { t } from './i18n';
import {
  applyRemotePlaces,
  applyScan,
  audiobookshelfMe,
  audiobookshelfScan,
  listAudiobookshelfItems,
  DEFAULT_PROFILE_ID,
  getProfile,
  jellyfinScan,
  listJellyfinItems,
  setRemoteCovers,
  type FileTags,
  filesNeedingTags,
  type ListedFile,
  listRoots,
  listS3,
  listWebdav,
  upsertRoot,
} from '@lelap/core';
import { Directory, Paths } from 'expo-file-system';

import { forgetAudiobookshelfParts } from './audiobookshelf';
import { db, newId } from './db';
import {
  FOLDER_UNAVAILABLE,
  listTree,
  pickFolder,
  readImage,
  readRemoteTags,
  readTags,
} from './platform/library';
import { fileAccess } from './remote';

export type ScanResult = { added: number; missing: number } | { error: 'permission' | 'no-folder' };

const COVER_IMAGE = /^(cover|folder)\.(jpe?g|png|webp)$/i;

// Native code wants a plain path, not a file:// URI.
const coverDir = () =>
  decodeURI(new Directory(Paths.document, 'covers').uri.replace(/^file:\/\//, ''));

let running: Promise<ScanResult> | null = null;

/**
 * Brings the library in line with the phone's folder and every server. Reads tags only for new or
 * changed files. A root that cannot be read changes nothing, so its books are never marked missing
 * because of it.
 */
export function scanLibrary(
  onProgress: (done: number, total: number) => void = () => {},
): Promise<ScanResult> {
  running ??= run(onProgress).finally(() => {
    running = null;
  });
  return running;
}

type Root = ReturnType<typeof listRoots>[number];

async function listRoot(root: Root): Promise<ListedFile[]> {
  if (!root.remote) return listTree(root.uri);
  if (root.remote.type === 'webdav') return listWebdav((u, i) => fetch(u, i), root.remote);
  if (root.remote.type === 'jellyfin') throw new Error('Jellyfin is scanned by scanJellyfin.');
  if (root.remote.type === 'audiobookshelf') {
    throw new Error('Audiobookshelf is scanned by scanAudiobookshelf.');
  }
  return listS3((u, i) => fetch(u, i), root.remote, Date.now());
}

async function tagsFor(root: Root, file: ListedFile, dir: string): Promise<FileTags> {
  if (!root.remote) return readTags(file.uri, file.name, dir);
  const access = fileAccess({ uri: file.uri, rootId: root.id });
  return readRemoteTags(access.uri, access.headers, file.name, dir);
}

async function run(onProgress: (done: number, total: number) => void): Promise<ScanResult> {
  const roots = listRoots(db);
  if (roots.length === 0) return { error: 'no-folder' };
  // Only folder and WebDAV or S3 scans keep covers on the device; the web build has no such
  // folder, and Jellyfin and Audiobookshelf scans don't need one.
  let covers: string | null = null;
  const dir = () => (covers ??= coverDir());
  let added = 0;
  let missing = 0;
  let lostLocal = false;

  for (const root of roots) {
    if (root.remote?.type === 'jellyfin') {
      const result = await scanJellyfin(root, root.remote).catch(() => null);
      added += result?.added ?? 0;
      missing += result?.missing ?? 0;
      continue;
    }
    if (root.remote?.type === 'audiobookshelf') {
      const result = await scanAudiobookshelf(root, root.remote).catch(() => null);
      added += result?.added ?? 0;
      missing += result?.missing ?? 0;
      continue;
    }
    let listed: ListedFile[];
    try {
      listed = await listRoot(root);
    } catch (error) {
      if (!root.remote && isCode(error, FOLDER_UNAVAILABLE)) lostLocal = true;
      // A server that is down or refuses keeps its books as they are until the next scan.
      continue;
    }

    const need = filesNeedingTags(db, listed);
    const tags = new Map<string, FileTags>();
    for (const [i, file] of need.entries()) {
      onProgress(i, need.length);
      try {
        tags.set(file.location, await tagsFor(root, file, dir()));
      } catch {
        // Unreadable now; stored with empty tags and tried again on the next scan.
      }
    }
    onProgress(need.length, need.length);

    // `cover.jpg` files are read from the phone's folder only; servers give embedded covers.
    const folderCovers = new Map<string, string>();
    if (!root.remote) {
      for (const file of listed.filter((f) => COVER_IMAGE.test(f.name))) {
        const folder = file.location.slice(0, file.location.lastIndexOf('/'));
        if (folderCovers.has(folder)) continue;
        const path = await readImage(file.uri, dir()).catch(() => null);
        if (path) folderCovers.set(folder, path);
      }
    }

    const result = applyScan(db, {
      rootId: root.id,
      rootLocation: root.location,
      listed,
      tags,
      folderCovers,
      now: Date.now(),
      newId,
    });
    added += result.added;
    missing += result.missing;
  }
  if (lostLocal) return { error: 'permission' };
  return { added, missing };
}

/**
 * A Jellyfin server gives its tags, chapters and covers with the listing, so no file is read.
 * The user's places there come along and win where they are newer.
 */
async function scanJellyfin(
  root: Root,
  remote: Extract<NonNullable<Root['remote']>, { type: 'jellyfin' }>,
): Promise<{ added: number; missing: number }> {
  if (root.needsLogin) throw new Error(t('The Jellyfin login is needed again.'));
  const items = await listJellyfinItems((u, i) => fetch(u, i), remote);
  const scan = jellyfinScan(remote, items);
  const now = Date.now();
  const result = applyScan(db, {
    rootId: root.id,
    rootLocation: root.location,
    listed: scan.listed,
    tags: scan.tags,
    folderCovers: new Map(),
    now,
    newId,
  });
  setRemoteCovers(db, root.id, scan.covers, now);
  // The profile that added the server; the first one if it has since been deleted.
  const profile = getProfile(db, remote.profileId) ? remote.profileId : DEFAULT_PROFILE_ID;
  applyRemotePlaces(db, profile, scan.places, now);
  return result;
}

/**
 * Audiobookshelf, like Jellyfin, gives tags, chapters and covers with the listing. The user's
 * places come from `/api/me` and win where they are newer.
 */
async function scanAudiobookshelf(
  root: Root,
  remote: Extract<NonNullable<Root['remote']>, { type: 'audiobookshelf' }>,
): Promise<{ added: number; missing: number }> {
  if (root.needsLogin) throw new Error(t('The Audiobookshelf API key is needed again.'));
  const fetcher = (u: string, i?: RequestInit) => fetch(u, i);
  const items = await listAudiobookshelfItems(fetcher, remote, remote.token);
  const me = await audiobookshelfMe(fetcher, remote.url, remote.token);
  const scan = audiobookshelfScan(remote, items, me.mediaProgress);
  const now = Date.now();
  const result = applyScan(db, {
    rootId: root.id,
    rootLocation: root.location,
    listed: scan.listed,
    tags: scan.tags,
    folderCovers: new Map(),
    now,
    newId,
  });
  setRemoteCovers(db, root.id, scan.covers, now);
  const profile = getProfile(db, remote.profileId) ? remote.profileId : DEFAULT_PROFILE_ID;
  applyRemotePlaces(db, profile, scan.places, now);
  forgetAudiobookshelfParts();
  return result;
}

/** Lets the user choose the library folder. Returns false when they cancel. */
export async function chooseFolder(): Promise<boolean> {
  const folder = await pickFolder();
  if (!folder) return false;
  upsertRoot(db, folder, Date.now(), newId);
  return true;
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
