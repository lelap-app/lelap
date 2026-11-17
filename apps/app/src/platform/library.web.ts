import type { FileTags, ListedFile } from '@lelap/core';

// The web build has no local library folder: books come from add-ons and podcasts. These keep
// the Android scan code importable and report that there is no folder.

export type PickedFolder = { uri: string; name: string; location: string };

export const FOLDER_UNAVAILABLE = 'ERR_LELAP_PERMISSION';
export const LOCAL_FOLDERS = false;

// Chapters from silences are Android only: a browser decodes a whole file into memory at once,
// and a ten-hour book is gigabytes of samples (see docs/brief.md, “Chapters”).
export const SILENCE_SCAN = false;

export type SilenceStatus = {
  bookId: string;
  state: 'waiting' | 'running' | 'done' | 'failed';
  filesDone: number;
  filesTotal: number;
  result: string | null;
  error: string | null;
};

export const findSilences = (): Promise<void> => unsupported();
export const silenceStatuses = (): Promise<SilenceStatus[]> => Promise.resolve([]);
export const removeSilences = (): Promise<void> => Promise.resolve();

const unsupported = () => Promise.reject(new Error('Local folders are only on Android.'));

export const pickFolder = (): Promise<PickedFolder | null> => Promise.resolve(null);
export const hasPermission = (): Promise<boolean> => Promise.resolve(false);
export const listTree = (): Promise<ListedFile[]> => unsupported();
export const readTags = (): Promise<FileTags> => unsupported();
export const readImage = (): Promise<string | null> => Promise.resolve(null);

/**
 * In the browser only the duration, from the audio element: enough for the book's timeline. Tags
 * and chapters of files on servers are read by the Android app.
 */
export function readRemoteTags(url: string): Promise<FileTags> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.onloadedmetadata = () =>
      resolve({
        durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0,
        title: null,
        album: null,
        artist: null,
        albumArtist: null,
        coverPath: null,
        chapters: [],
      });
    audio.onerror = () => reject(new Error('The browser could not read this file.'));
    audio.src = url;
  });
}
