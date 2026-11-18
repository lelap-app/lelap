import { t } from './i18n';
import {
  addonLibraryScan,
  addonLogin,
  addonSettings,
  addonSourceHosts,
  type AddonScan,
  applyRemotePlaces,
  sameAddonCode,
  applyScan,
  audiobookshelfMe,
  audiobookshelfScan,
  listAudiobookshelfItems,
  DEFAULT_PROFILE_ID,
  getProfile,
  jellyfinScan,
  listJellyfinItems,
  setRemoteCovers,
  coverGuesses,
  type FileTags,
  filesNeedingTags,
  fillTags,
  folderCoverCacheName,
  folderCoverFiles,
  IMAGE_HEAD_BYTES,
  imageSize,
  type ImageSize,
  type ListedFile,
  listRoots,
  listS3,
  listWebdav,
  scanFailureEvent,
  scanNeedsAccess,
  setNetServerRefused,
  updateRemoteRoot,
  upsertRoot,
  withAddonLogin,
} from '@lelap/core';
import { idsFromTags } from '@lelap/sdk';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { codeFingerprint, listAddonLibrary, sourceManifest } from './addonSources';
import { forgetAddonPlaceParts } from './addonPlaces';
import { forgetAudiobookshelfParts, withKey } from './audiobookshelf';
import { db, newId } from './db';
import { logDiagnostic } from './diagnostics';
import {
  FOLDER_UNAVAILABLE,
  imageSize as readImageSize,
  listTree,
  pickFolder,
  readImage,
  readRemoteTags,
  readTags,
} from './platform/library';
import { currentLocalNetworkAccess, isLocalServer, markNeedsLocalNetwork } from './localNetwork';
import { listNetServer } from './netServers';
import { copyTo, NETFS_ERRORS } from './platform/netfs';
import { fileAccess } from './remote';
import { saveWebCover } from './webCovers';

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
  if (root.remote.type === 'smb' || root.remote.type === 'sftp') {
    if (root.needsLogin)
      throw new Error(t('The password for {name} is needed again.', { name: root.name }));
    return listNetServer(root.remote);
  }
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
 * A WebDAV, SMB, SFTP or S3 folder's cover, or an add-on server's, downloaded once per version of
 * the image. The web keeps it in the origin private file system.
 */
async function fetchFolderCover(root: Root, file: ListedFile): Promise<string | null> {
  if (Platform.OS === 'web') {
    const access = fileAccess({ uri: file.uri, rootId: root.id });
    return saveWebCover(access.uri, access.headers, folderCoverCacheName(file));
  }
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
    if (root.remote?.type === 'smb' || root.remote?.type === 'sftp') {
      await copyTo(access.uri, access.headers, pathOf(part));
    } else {
      await File.downloadFileAsync(access.uri, part, { headers: access.headers });
    }
    part.move(target);
  } catch (error) {
    if (part.exists) part.delete();
    throw error;
  }
  return pathOf(target);
}

/** A cover from the phone's folder, saved once per version of the image like a server's. */
async function saveLocalImage(file: ListedFile): Promise<string | null> {
  const name = folderCoverCacheName(file).replace(/\.[^.]+$/, '.jpg');
  const target = new File(new Directory(Paths.document, 'covers'), name);
  if (target.exists) return decodeURI(target.uri.replace(/^file:\/\//, ''));
  return readImage(file.uri, coverDir(), name);
}

/**
 * An image's width and height for guessing a cover among several: Android reads the header of a
 * file on the phone; a WebDAV, S3 or add-on server is asked for the first 64 KB, from the browser
 * too. SMB and SFTP can only copy whole files, and a server that refuses the request gives no
 * size either; those guesses go by file size.
 */
async function imageSizeOf(root: Root, file: ListedFile): Promise<ImageSize | null> {
  if (!root.remote) return readImageSize(file.uri);
  if (root.remote.type === 'smb' || root.remote.type === 'sftp') return null;
  const access = fileAccess({ uri: file.uri, rootId: root.id });
  const response = await fetch(access.uri, {
    headers: { ...access.headers, Range: `bytes=0-${IMAGE_HEAD_BYTES - 1}` },
  });
  if (!response.ok) return null;
  // A server that ignores Range sends the whole image; only its start is read.
  return imageSize(new Uint8Array(await response.arrayBuffer()).subarray(0, IMAGE_HEAD_BYTES));
}

/**
 * Covers from image files beside the audio (`folderCoverFiles` has the rules), for books whose
 * files carry none. A server's image is fetched with the same login as its audio, straight from
 * the server, and kept with the other covers (in the origin private file system on the web).
 */
async function imageCovers(
  root: Root,
  listed: ListedFile[],
): Promise<{
  folderCovers: Map<string, string>;
  fileCovers: Map<string, string>;
  looseCovers: Map<string, string>;
}> {
  const folderCovers = new Map<string, string>();
  const fileCovers = new Map<string, string>();
  const looseCovers = new Map<string, string>();
  const sizes = new Map<string, ImageSize>();
  for (const file of coverGuesses(listed)) {
    const size = await imageSizeOf(root, file).catch(() => null);
    if (size) sizes.set(file.location, size);
  }
  const chosen = folderCoverFiles(listed, sizes);
  const saved = new Map<string, Promise<string | null>>();
  const save = (file: ListedFile) => {
    let path = saved.get(file.location);
    if (!path) {
      path = (root.remote ? fetchFolderCover(root, file) : saveLocalImage(file)).catch(() => null);
      saved.set(file.location, path);
    }
    return path;
  };
  for (const [folder, file] of chosen.byFolder) {
    const path = await save(file);
    if (path) folderCovers.set(folder, path);
  }
  for (const [audio, file] of chosen.byFile) {
    const path = await save(file);
    if (path) fileCovers.set(audio, path);
  }
  for (const [folder, file] of chosen.forLoose) {
    const path = await save(file);
    if (path) looseCovers.set(folder, path);
  }
  return { folderCovers, fileCovers, looseCovers };
}

async function run(onProgress: (done: number, total: number) => void): Promise<ScanResult> {
  const roots = listRoots(db);
  if (roots.length === 0) return { error: 'no-folder' };
  // Only folder, WebDAV, SMB, SFTP and S3 scans keep covers on the device; the web build keeps
  // server covers in OPFS instead, and Jellyfin and Audiobookshelf scans don't need one.
  let covers: string | null = null;
  const dir = () => (covers ??= coverDir());
  let added = 0;
  let missing = 0;
  let lostLocal = false;
  const lanAccess = await currentLocalNetworkAccess();

  const failed = (root: Root) => (error: unknown) => {
    logDiagnostic(scanFailureEvent(root.id, root.remote, error));
    return null;
  };

  for (const root of roots) {
    // Android 17 without local network access: a server at home is skipped, not tried, and marked
    // so Settings can ask. Its books stay as they are.
    const skip = root.remote ? scanNeedsAccess(isLocalServer(root.remote), lanAccess) : false;
    markNeedsLocalNetwork(root.id, skip);
    if (skip) {
      logDiagnostic(scanFailureEvent(root.id, root.remote, null, 'permission'));
      continue;
    }
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
      // A refused login or a changed host key shows in Settings until a scan works again.
      if (isCode(error, NETFS_ERRORS.login)) setNetServerRefused(db, root.id, 'login', Date.now());
      if (isCode(error, NETFS_ERRORS.hostKeyChanged)) {
        setNetServerRefused(db, root.id, 'host-key', Date.now());
      }
      logDiagnostic(scanFailureEvent(root.id, root.remote, error, lost ? 'permission' : undefined));
      // A server that is down or refuses keeps its books as they are until the next scan.
      continue;
    }

    // Android's reader gives ISBN and ASIN tags, genre and ISRC; the browser's reads only the
    // duration.
    const native = Platform.OS !== 'web';
    const need = filesNeedingTags(db, listed, { readsIds: native, readsKinds: native }).filter(
      (f) => !fromAddon?.tags.has(f.location),
    );
    const tags = new Map<string, FileTags>(fromAddon?.tags ?? []);
    for (const [i, file] of need.entries()) {
      onProgress(i, need.length);
      try {
        // The browser keeps no covers folder (asking for one throws) and reads only durations;
        // an add-on's tags for the file fill in the rest.
        const read = await tagsFor(root, file, Platform.OS === 'web' ? '' : dir());
        tags.set(file.location, fillTags(read, fromAddon?.hints.get(file.location)));
      } catch {
        // Unreadable now; stored with empty tags and tried again on the next scan.
      }
    }
    onProgress(need.length, need.length);

    const { folderCovers, fileCovers, looseCovers } = await imageCovers(root, listed);

    const result = applyScan(db, {
      rootId: root.id,
      rootLocation: root.location,
      listed,
      tags,
      folderCovers,
      fileCovers,
      looseCovers,
      now: Date.now(),
      newId,
    });
    setNetServerRefused(db, root.id, null, Date.now());
    if (fromAddon) {
      setRemoteCovers(db, root.id, fromAddon.covers, Date.now());
      // A server's places (revision 6), for the profile that added it; the newest place wins.
      const remote = root.remote?.type === 'addon' ? root.remote : null;
      const profile =
        remote?.profileId && getProfile(db, remote.profileId)
          ? remote.profileId
          : DEFAULT_PROFILE_ID;
      applyRemotePlaces(db, profile, fromAddon.places, Date.now());
      forgetAddonPlaceParts();
    }
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
  // A different file under the same ID gets the settings only once the listener enters them again.
  if (!sameAddonCode(remote, codeFingerprint(remote.addonUrl))) {
    throw new Error(
      t('The add-on for {name} changed. Log in again to use it.', { name: remote.name }),
    );
  }
  const response = await listAddonLibrary({
    addonUrl: remote.addonUrl,
    manifest,
    sandboxId: root.id,
    settings: addonSettings(remote),
  });
  const login = addonLogin(remote);
  const headers = response.headers ?? {};
  const query = response.query ?? {};
  const webQuery = response.webQuery ?? {};
  if (
    JSON.stringify(login.headers) !== JSON.stringify(headers) ||
    JSON.stringify(login.query) !== JSON.stringify(query) ||
    JSON.stringify(login.webQuery) !== JSON.stringify(webQuery)
  ) {
    const next = withAddonLogin(remote, { ...login, headers, query, webQuery });
    updateRemoteRoot(db, root.id, next, Date.now());
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
