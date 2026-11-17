import type { FileTags, ListedFile } from '@lelap/core';
import { requireNativeModule } from 'expo';

export type PickedFolder = {
  /** Tree URI with a persisted read permission. */
  uri: string;
  name: string;
  /** Volume path, such as `primary:Audiobooks`. */
  location: string;
};

/** Error code when the folder can no longer be read (permission revoked, storage gone). */
export const FOLDER_UNAVAILABLE = 'ERR_LELAP_PERMISSION';

type LelapLibraryModule = {
  pickFolder(): Promise<PickedFolder | null>;
  hasPermission(uri: string): Promise<boolean>;
  listTree(uri: string): Promise<ListedFile[]>;
  readTags(uri: string, name: string, coverDir: string): Promise<FileTags>;
  readImage(uri: string, coverDir: string): Promise<string | null>;
  readRemoteTags(
    url: string,
    headers: Record<string, string>,
    name: string,
    coverDir: string,
  ): Promise<FileTags>;
};

const native = requireNativeModule<LelapLibraryModule>('LelapLibrary');

/** Opens Android's folder picker and keeps read access to the chosen folder across restarts. */
export function pickFolder(): Promise<PickedFolder | null> {
  return native.pickFolder();
}

export function hasPermission(uri: string): Promise<boolean> {
  return native.hasPermission(uri);
}

/** Every file below the folder. Rejects with FOLDER_UNAVAILABLE when the folder cannot be read. */
export function listTree(uri: string): Promise<ListedFile[]> {
  return native.listTree(uri);
}

/**
 * Tags, duration, embedded cover (saved as a small JPEG in `coverDir`) and chapters of an audio
 * file. `coverDir` is a plain file path, not a `file://` URI.
 */
export function readTags(uri: string, name: string, coverDir: string): Promise<FileTags> {
  return native.readTags(uri, name, coverDir);
}

/** Saves an image file such as `cover.jpg` as a small cover in `coverDir`; returns its path. */
export function readImage(uri: string, coverDir: string): Promise<string | null> {
  return native.readImage(uri, coverDir);
}

/** Tags, duration, cover and chapters of a file on a server, read with [headers] (its login). */
export function readRemoteTags(
  url: string,
  headers: Record<string, string>,
  name: string,
  coverDir: string,
): Promise<FileTags> {
  return native.readRemoteTags(url, headers, name, coverDir);
}
