import {
  applyScan,
  type FileTags,
  filesNeedingTags,
  type ListedFile,
  listRoots,
  listS3,
  listWebdav,
  upsertRoot,
} from '@lelap/core';
import { Directory, Paths } from 'expo-file-system';

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
  const dir = coverDir();
  let added = 0;
  let missing = 0;
  let lostLocal = false;

  for (const root of roots) {
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
        tags.set(file.location, await tagsFor(root, file, dir));
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
        const path = await readImage(file.uri, dir).catch(() => null);
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
