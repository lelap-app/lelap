import type { FileTags, ListedFile } from '@lelap/core';

// The web build has no local library folder: books come from add-ons and podcasts. These keep
// the Android scan code importable and report that there is no folder.

export type PickedFolder = { uri: string; name: string; location: string };

export const FOLDER_UNAVAILABLE = 'ERR_LELAP_PERMISSION';
export const LOCAL_FOLDERS = false;

const unsupported = () => Promise.reject(new Error('Local folders are only on Android.'));

export const pickFolder = (): Promise<PickedFolder | null> => Promise.resolve(null);
export const hasPermission = (): Promise<boolean> => Promise.resolve(false);
export const listTree = (): Promise<ListedFile[]> => unsupported();
export const readTags = (): Promise<FileTags> => unsupported();
export const readImage = (): Promise<string | null> => Promise.resolve(null);
