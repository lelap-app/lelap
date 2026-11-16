import { applyScan, type FileTags, filesNeedingTags, schema, upsertRoot } from '@lelap/core';
import { Directory, Paths } from 'expo-file-system';

import { db, newId } from './db';
import { FOLDER_UNAVAILABLE, listTree, pickFolder, readImage, readTags } from './platform/library';

export type ScanResult = { added: number; missing: number } | { error: 'permission' | 'no-folder' };

const COVER_IMAGE = /^(cover|folder)\.(jpe?g|png|webp)$/i;

// Native code wants a plain path, not a file:// URI.
const coverDir = () =>
  decodeURI(new Directory(Paths.document, 'covers').uri.replace(/^file:\/\//, ''));

let running: Promise<ScanResult> | null = null;

/**
 * Brings the library in line with the folder. Reads tags only for new or changed files. A folder
 * that cannot be read changes nothing, so books are never marked missing because of it.
 */
export function scanLibrary(
  onProgress: (done: number, total: number) => void = () => {},
): Promise<ScanResult> {
  running ??= run(onProgress).finally(() => {
    running = null;
  });
  return running;
}

async function run(onProgress: (done: number, total: number) => void): Promise<ScanResult> {
  const root = db.select().from(schema.libraryRoots).get();
  if (!root) return { error: 'no-folder' };

  let listed;
  try {
    listed = await listTree(root.uri);
  } catch (error) {
    if (isCode(error, FOLDER_UNAVAILABLE)) return { error: 'permission' };
    throw error;
  }

  const dir = coverDir();
  const need = filesNeedingTags(db, listed);
  const tags = new Map<string, FileTags>();
  for (const [i, file] of need.entries()) {
    onProgress(i, need.length);
    try {
      tags.set(file.location, await readTags(file.uri, file.name, dir));
    } catch {
      // Unreadable now; stored with empty tags and tried again on the next scan.
    }
  }
  onProgress(need.length, need.length);

  const folderCovers = new Map<string, string>();
  for (const file of listed.filter((f) => COVER_IMAGE.test(f.name))) {
    const folder = file.location.slice(0, file.location.lastIndexOf('/'));
    if (folderCovers.has(folder)) continue;
    const path = await readImage(file.uri, dir).catch(() => null);
    if (path) folderCovers.set(folder, path);
  }

  return applyScan(db, {
    rootId: root.id,
    rootLocation: root.location,
    listed,
    tags,
    folderCovers,
    now: Date.now(),
    newId,
  });
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
