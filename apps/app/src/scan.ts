import { t } from './i18n';
import {
  addonLibraryScan,
  addonLogin,
  addonSettings,
  addonSourceHosts,
  type AddonScan,
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
  folderCoverCacheName,
  folderCoverFiles,
  type ListedFile,
  listRoots,
  listS3,
  listWebdav,
  scanFailureEvent,
  updateRemoteRoot,
  upsertRoot,
  withAddonLogin,
} from '@lelap/core';
import { idsFromTags } from '@lelap/sdk';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { listAddonLibrary, sourceManifest } from './addonSources';
import { forgetAudiobookshelfParts, withKey } from './audiobookshelf';
import { db, newId } from './db';
import { logDiagnostic } from './diagnostics';
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
  if (root.remote.type === 'addon') throw new Error('Add-ons are scanned by scanAddonSource.');
  return listS3((u, i) => fetch(u, i), root.remote, Date.now());
}

async function tagsFor(root: Root, file: ListedFile, dir: string): Promise<FileTags> {
  let read: FileTags & { idTags?: Record<string, string> };
  if (!root.remote) read = await readTags(file.uri, file.name, dir);
  else {
    const access = fileAccess({ uri: file.uri, rootId: root.id });
    read = await readRemoteTags(access.uri, access.headers, file.name, dir);
  }
  // The native reader gives ISBN and ASIN tags by name; the SDK checks and normalises them.
  const { idTags, ...tags } = read;
  return idTags ? { ...tags, ids: idsFromTags(idTags) } : tags;
}

/**
 * A WebDAV or S3 folder's cover, downloaded once per version of the image. Null on the web, which
 * keeps no covers folder.
 */
async function fetchFolderCover(root: Root, file: ListedFile): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const folder = new Directory(Paths.document, 'covers');
  if (!folder.exists) folder.create({ intermediates: true });
  const target = new File(folder, folderCoverCacheName(file));
  const pathOf = (f: File) => decodeURI(f.uri.replace(/^file:\/\//, ''));
  if (target.exists) return pathOf(target);
  // Partial downloads never stay under the final name, or a broken image would be kept for good.
  const part = new File(folder, `${folderCoverCacheName(file)}.part`);
  if (part.exists) part.delete();
  const access = fileAccess({ uri: file.uri, rootId: root.id });
  try {
    await File.downloadFileAsync(access.uri, part, { headers: access.headers });
    part.move(target);
  } catch (error) {
    if (part.exists) part.delete();
    throw error;
  }
  return pathOf(target);
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

  const failed = (root: Root) => (error: unknown) => {
    logDiagnostic(scanFailureEvent(root.id, root.remote, error));
    return null;
  };

  for (const root of roots) {
    if (root.remote?.type === 'jellyfin') {
      const result = await scanJellyfin(root, root.remote).catch(failed(root));
      added += result?.added ?? 0;
      missing += result?.missing ?? 0;
      continue;
    }
    if (root.remote?.type === 'audiobookshelf') {
      const result = await scanAudiobookshelf(root, root.remote).catch(failed(root));
      added += result?.added ?? 0;
      missing += result?.missing ?? 0;
      continue;
    }
    // An add-on's listing may come with tags, which then aren't read from the files.
    let fromAddon: AddonScan | null = null;
    let listed: ListedFile[];
    try {
      if (root.remote?.type === 'addon') {
        fromAddon = await scanAddonSource(root, root.remote);
        listed = fromAddon.listed;
      } else {
        listed = await listRoot(root);
      }
    } catch (error) {
      const lost = !root.remote && isCode(error, FOLDER_UNAVAILABLE);
      if (lost) lostLocal = true;
      logDiagnostic(scanFailureEvent(root.id, root.remote, error, lost ? 'permission' : undefined));
      // A server that is down or refuses keeps its books as they are until the next scan.
      continue;
    }

    // Android's reader gives ISBN and ASIN tags; the browser's reads only the duration.
    const need = filesNeedingTags(db, listed, { readsIds: Platform.OS !== 'web' }).filter(
      (f) => !fromAddon?.tags.has(f.location),
    );
    const tags = new Map<string, FileTags>(fromAddon?.tags ?? []);
    for (const [i, file] of need.entries()) {
      onProgress(i, need.length);
      try {
        tags.set(file.location, await tagsFor(root, file, dir()));
      } catch {
        // Unreadable now; stored with empty tags and tried again on the next scan.
      }
    }
    onProgress(need.length, need.length);

    // `cover.jpg` and friends, for books whose files carry no cover. A server's image is fetched
    // with the same login as its audio, straight from the server, and kept with the other covers.
    const folderCovers = new Map<string, string>();
    for (const [folder, file] of folderCoverFiles(listed)) {
      const path = await (
        root.remote ? fetchFolderCover(root, file) : readImage(file.uri, dir())
      ).catch(() => null);
      if (path) folderCovers.set(folder, path);
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
    if (fromAddon) setRemoteCovers(db, root.id, fromAddon.covers, Date.now());
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
  const [items, me] = await withKey(
    root.id,
    Promise.all([
      listAudiobookshelfItems(fetcher, remote, remote.token),
      audiobookshelfMe(fetcher, remote.url, remote.token),
    ]),
  );
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

/**
 * An add-on inside the app lists the server's files (M57), in that server's own sandbox and with
 * its settings. The headers it asks for are kept sealed with the login, for playing and
 * downloading; files and covers on hosts it may not reach are left out.
 */
async function scanAddonSource(
  root: Root,
  remote: Extract<NonNullable<Root['remote']>, { type: 'addon' }>,
): Promise<AddonScan> {
  if (root.needsLogin)
    throw new Error(t('The login for {name} is needed again.', { name: remote.name }));
  const manifest = sourceManifest(remote.addonUrl);
  if (!manifest) throw new Error(t('The add-on for this server is no longer on this device.'));
  const response = await listAddonLibrary({
    addonUrl: remote.addonUrl,
    manifest,
    sandboxId: root.id,
    settings: addonSettings(remote),
  });
  const login = addonLogin(remote);
  const headers = response.headers ?? {};
  if (JSON.stringify(login.headers) !== JSON.stringify(headers)) {
    updateRemoteRoot(db, root.id, withAddonLogin(remote, { ...login, headers }), Date.now());
  }
  return addonLibraryScan(root.location, response, addonSourceHosts(manifest, remote.settings));
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
