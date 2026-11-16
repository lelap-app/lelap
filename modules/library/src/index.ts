import type { ListedFile } from '@lelap/core';
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
