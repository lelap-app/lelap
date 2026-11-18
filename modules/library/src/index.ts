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

/**
 * Tags as the native reader gives them: ISBN and ASIN tags by name, not yet checked, and genre,
 * ISRC and the MP4 media kind (`kindTags`, M77).
 */
export type NativeTags = Omit<FileTags, 'ids'> & { idTags?: Record<string, string> };

type LelapLibraryModule = {
  pickFolder(): Promise<PickedFolder | null>;
  hasPermission(uri: string): Promise<boolean>;
  listTree(uri: string): Promise<ListedFile[]>;
  readTags(uri: string, name: string, coverDir: string): Promise<NativeTags>;
  readImage(uri: string, coverDir: string, fileName: string | null): Promise<string | null>;
  imageSize(uri: string): Promise<{ width: number; height: number } | null>;
  readRemoteTags(
    url: string,
    headers: Record<string, string>,
    name: string,
    coverDir: string,
  ): Promise<NativeTags>;
  findSilences(jobJson: string): Promise<void>;
  silenceStatuses(): Promise<SilenceStatus[]>;
  removeSilences(bookId: string): Promise<void>;
};

/** Same shape as `SilenceScanStatus` in the app. `result` is JSON: silences per file. */
export type SilenceStatus = {
  bookId: string;
  state: 'waiting' | 'running' | 'done' | 'failed';
  filesDone: number;
  filesTotal: number;
  /** How far the scan is through the book, 0 to 1. */
  fraction: number;
  /** Waiting because the battery is low now, not just waiting to start (M85). */
  lowBattery: boolean;
  result: string | null;
  error: string | null;
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
export function readTags(uri: string, name: string, coverDir: string): Promise<NativeTags> {
  return native.readTags(uri, name, coverDir);
}

/**
 * Saves an image file such as `cover.jpg` as a small cover in `coverDir`, under `fileName` when
 * given; returns its path.
 */
export function readImage(
  uri: string,
  coverDir: string,
  fileName: string | null = null,
): Promise<string | null> {
  return native.readImage(uri, coverDir, fileName);
}

/** An image's width and height from its header, without decoding it; null when unknown. */
export function imageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return native.imageSize(uri);
}

/** Tags, duration, cover and chapters of a file on a server, read with [headers] (its login). */
export function readRemoteTags(
  url: string,
  headers: Record<string, string>,
  name: string,
  coverDir: string,
): Promise<NativeTags> {
  return native.readRemoteTags(url, headers, name, coverDir);
}

/**
 * Starts a background scan of a book's files on this device for long silences (M45). Files are
 * `content://` or `file://` URIs. It starts at once (M85) and waits or stops while the battery is
 * low. `title` names it in the notification; `durationsMs`, each file's stored length, moves its bar.
 */
export function findSilences(job: {
  bookId: string;
  title: string;
  files: string[];
  durationsMs: number[];
  thresholdDb: number;
  minSilenceMs: number;
}): Promise<void> {
  return native.findSilences(JSON.stringify(job));
}

export function silenceStatuses(): Promise<SilenceStatus[]> {
  return native.silenceStatuses();
}

/** Stops a scan, or forgets a finished one. */
export function removeSilences(bookId: string): Promise<void> {
  return native.removeSilences(bookId);
}
