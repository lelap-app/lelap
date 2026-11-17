import {
  applyDownloadStatuses,
  type DownloadEntry,
  getDownload,
  getSettings,
  listDownloads,
  planDownload,
  removeDownload,
  requestDownload,
  type Settings,
} from '@lelap/core';
import type { Meta } from '@lelap/sdk';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { showAlert } from './dialog';
import { queryClient } from './addons';
import { db } from './db';
import { formatBytes } from './format';
import * as native from './platform/downloads';
import { reloadBook, useLibrary } from './player';
import { profileId } from './profile';
import { fileAccess } from './remote';

export type { DownloadStatus } from './platform/downloads';

const DOWNLOADS_KEY = ['downloads'];
const POLL_RUNNING_MS = 1_500;
const POLL_WAITING_MS = 10_000;

export const rulesOf = (settings: Settings): native.DownloadRules => ({
  wifiOnly: settings.downloadOnWifiOnly,
  chargingOnly: settings.downloadWhileChargingOnly,
});

const currentRules = () => rulesOf(getSettings(db, profileId));

/** Notifications for the progress bar, and leave to run while the phone sleeps. */
async function askForBackgroundWork(): Promise<void> {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  if (native.isIgnoringBatteryOptimizations()) return;
  showAlert(
    'Download while the phone sleeps',
    'Android holds background work back while the screen is off. Let Lelap run in the background so a book can download overnight.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Allow', onPress: () => void native.requestBatteryExemption() },
    ],
  );
}

/** Starts downloading a streamed book in the library. `meta` is kept for offline use. */
export async function startDownload(bookId: string, meta: Meta | null): Promise<void> {
  const first = listDownloads(db).length === 0;
  const plan = planDownload(db, bookId);
  requestDownload(db, plan, meta, Date.now());
  // Files on a server: S3 links signed now, WebDAV with its login (sent to that host only).
  const access = plan.files.map((f) => fileAccess({ uri: f.url, rootId: f.rootId }));
  await native.enqueue(
    {
      ...plan,
      files: plan.files.map((f, i) => ({
        url: access[i]?.uri ?? f.url,
        name: f.name,
        size: f.size,
      })),
      headers: access[0]?.headers ?? {},
    },
    currentRules(),
  );
  void queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY });
  if (first) await askForBackgroundWork();
}

/** Cancels or deletes a download; the book stays in the library and streams again. */
export async function deleteDownload(bookId: string): Promise<void> {
  removeDownload(db, bookId, Date.now());
  // Switch the player to the stream before the files go. The book itself may be gone already.
  await reloadBook(bookId, true).catch(() => {});
  await native.remove(bookId);
  void queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY });
}

/** Applies changed rules to downloads that have not finished. */
export function applyRules(settings: Settings): Promise<void> {
  return native.setRules(rulesOf(settings));
}

/** Reads the worker's statuses and folds them into the database. */
async function syncDownloads(onChange: () => void): Promise<Map<string, native.DownloadStatus>> {
  const statuses = await native.statuses();
  const fold = applyDownloadStatuses(db, native.directory(), statuses, Date.now());
  for (const orphan of fold.orphans) await native.remove(orphan);
  for (const bookId of fold.changed) {
    // A paused book picks up its new files now; a playing one at its next load.
    if (getDownload(db, bookId)?.state === 'done') await reloadBook(bookId, false).catch(() => {});
  }
  if (fold.changed.length > 0) onChange();
  return new Map(
    statuses.filter((s) => !fold.orphans.includes(s.bookId)).map((s) => [s.bookId, s]),
  );
}

/** Live statuses by book ID, polled while a download is waiting or running. */
export function useDownloadStatuses(): Map<string, native.DownloadStatus> {
  const { refresh } = useLibrary();
  const query = useQuery({
    queryKey: DOWNLOADS_KEY,
    queryFn: () => syncDownloads(refresh),
    refetchInterval: (q) => {
      const states = [...(q.state.data?.values() ?? [])].map((s) => s.state);
      if (states.includes('running')) return POLL_RUNNING_MS;
      return states.includes('waiting') ? POLL_WAITING_MS : false;
    },
  });
  return query.data ?? new Map();
}

/** Keeps downloads folded in while the app runs and when it returns to the foreground. */
export function DownloadSync() {
  useDownloadStatuses();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY });
    });
    return () => subscription.remove();
  }, []);
  return null;
}

function waitingFor(rules: native.DownloadRules): string {
  if (rules.wifiOnly && rules.chargingOnly) return 'Waiting for Wi-Fi and a charger';
  if (rules.wifiOnly) return 'Waiting for Wi-Fi';
  if (rules.chargingOnly) return 'Waiting for a charger';
  return 'Waiting for a connection';
}

export type DownloadView = {
  label: string;
  /** 0–1 while downloading. */
  progress: number | null;
  failed: boolean;
};

/** How a download reads on screen. */
export function describeDownload(
  entry: DownloadEntry,
  status: native.DownloadStatus | undefined,
  settings: Settings,
): DownloadView {
  if (entry.state === 'done') {
    return {
      label: entry.bytesTotal > 0 ? `Downloaded · ${formatBytes(entry.bytesTotal)}` : 'Downloaded',
      progress: null,
      failed: false,
    };
  }
  if (entry.state === 'failed') {
    return { label: entry.error ?? 'The download failed.', progress: null, failed: true };
  }
  if (status?.state === 'running') {
    const total = status.bytesTotal || entry.bytesTotal;
    const progress = total > 0 ? Math.min(1, status.bytesDone / total) : null;
    return {
      label:
        progress === null
          ? `Downloading · ${formatBytes(status.bytesDone)}`
          : `Downloading · ${Math.floor(progress * 100)} % of ${formatBytes(total)}`,
      progress,
      failed: false,
    };
  }
  return { label: waitingFor(rulesOf(settings)), progress: null, failed: false };
}
