import { NativeModule, requireNativeModule } from 'expo';

/** What to download for one book. Same shape as `DownloadPlan` in `@lelap/core`. */
export type DownloadJob = {
  bookId: string;
  title: string;
  files: { url: string; name: string; size: number }[];
  cover: { url: string; name: string } | null;
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
  error: string | null;
};

export type StorageInfo = { freeBytes: number; totalBytes: number; usedBytes: number };

declare class LelapDownloadModule extends NativeModule {
  directory(): string;
  enqueue(jobJson: string): Promise<void>;
  remove(bookId: string): Promise<void>;
  statuses(): Promise<DownloadStatus[]>;
  setRules(wifiOnly: boolean, chargingOnly: boolean): Promise<void>;
  storage(): Promise<StorageInfo>;
  isIgnoringBatteryOptimizations(): boolean;
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

export function isIgnoringBatteryOptimizations(): boolean {
  return native.isIgnoringBatteryOptimizations();
}

/** Opens Android's dialog that lets Lelap run downloads while the phone sleeps. */
export function requestBatteryExemption(): Promise<void> {
  return native.requestBatteryExemption();
}
