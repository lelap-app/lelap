import { NativeModule, requireNativeModule } from 'expo';

/** What to download for one book. Same shape as `DownloadPlan` in `@lelap/core`. */
export type DownloadJob = {
  bookId: string;
  title: string;
  files: { url: string; name: string; size: number }[];
  cover: { url: string; name: string } | null;
  /** Sent to the files' own host only: the login of a WebDAV server. */
  headers?: Record<string, string>;
};

/** When downloads may run. */
export type DownloadRules = { wifiOnly: boolean; chargingOnly: boolean };

/** Same shape as `NativeDownloadStatus` in `@lelap/core`. */
export type DownloadStatus = {
  bookId: string;
  state: 'waiting' | 'running' | 'done' | 'failed' | 'stopped';
  bytesDone: number;
  bytesTotal: number;
  files: string[];
  cover: string | null;
  /** Where each finished file is read from: a path, or a content URI in a chosen folder. */
  paths?: Record<string, string>;
  /** The book's folder can't be reached, such as an SD card that was taken out. */
  unavailable?: boolean;
  error: string | null;
};

export type StorageInfo = { freeBytes: number; totalBytes: number; usedBytes: number };

/** Where new downloads go, and how moving the earlier ones there is getting on. */
export type DownloadLocation = {
  /** The chosen folder; null for the app's private storage. */
  uri: string | null;
  /** `primary` for the phone's shared storage, `removable` for an SD card or USB drive. */
  volume: 'primary' | 'removable' | null;
  /** The folder's path on its storage, such as `Audiobooks`. */
  path: string | null;
  available: boolean;
  moving: boolean;
  /** Books whose files are not in this folder yet. */
  waiting: number;
  error: string | null;
};

declare class LelapDownloadModule extends NativeModule {
  directory(): string;
  enqueue(jobJson: string): Promise<void>;
  remove(bookId: string): Promise<void>;
  statuses(): Promise<DownloadStatus[]>;
  setRules(wifiOnly: boolean, chargingOnly: boolean): Promise<void>;
  storage(): Promise<StorageInfo>;
  location(): Promise<DownloadLocation>;
  chooseLocation(): Promise<boolean>;
  resetLocation(): Promise<void>;
  resumeMove(): Promise<void>;
  isIgnoringBatteryOptimizations(): boolean;
  canNotify(): boolean;
  notify(tag: string, title: string, text: string, link: string | null): boolean;
  requestBatteryExemption(): Promise<void>;
}

const native = requireNativeModule<LelapDownloadModule>('LelapDownload');

/** The folder that holds one subfolder per downloaded book. */
export function directory(): string {
  return native.directory();
}

/** Starts or restarts a book's download; parts already on disk are kept. */
export function enqueue(job: DownloadJob, rules: DownloadRules): Promise<void> {
  return native.enqueue(JSON.stringify({ ...job, rules }));
}

/** Cancels a download and deletes its files. */
export function remove(bookId: string): Promise<void> {
  return native.remove(bookId);
}

export function statuses(): Promise<DownloadStatus[]> {
  return native.statuses();
}

/** Applies new rules to every unfinished download. */
export function setRules(rules: DownloadRules): Promise<void> {
  return native.setRules(rules.wifiOnly, rules.chargingOnly);
}

export function storage(): Promise<StorageInfo> {
  return native.storage();
}

/** Whether downloads can go to a folder the listener chooses (Android only). */
export const CHOOSE_LOCATION = true;

export function location(): Promise<DownloadLocation> {
  return native.location();
}

/**
 * Opens Android's folder picker. New downloads go to the chosen folder, and earlier ones move
 * there in the background. False when the listener cancels.
 */
export function chooseLocation(): Promise<boolean> {
  return native.chooseLocation();
}

/** Back to the app's private storage, moving the downloads back too. */
export function resetLocation(): Promise<void> {
  return native.resetLocation();
}

/** Continues a move that stopped or waited for an SD card. */
export function resumeMove(): Promise<void> {
  return native.resumeMove();
}

export function isIgnoringBatteryOptimizations(): boolean {
  return native.isIgnoringBatteryOptimizations();
}

/** Opens Android's dialog that lets Lelap run downloads while the phone sleeps. */
export function requestBatteryExemption(): Promise<void> {
  return native.requestBatteryExemption();
}

/** Whether Lelap may post notifications (always true before Android 13). */
export function canNotify(): boolean {
  return native.canNotify();
}

/**
 * Posts a one-off notification, replacing an earlier one with the same tag. A tap opens `link`
 * (a deep link into the app) or the app. False when notifications are not allowed.
 */
export function notify(tag: string, title: string, text: string, link?: string): boolean {
  return native.notify(tag, title, text, link ?? null);
}
