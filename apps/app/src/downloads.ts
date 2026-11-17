import { t } from './i18n';
import {
  applyDownloadStatuses,
  type DownloadEntry,
  downloadFailureEvent,
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
import { logDiagnostic } from './diagnostics';
import { formatBytes } from './format';
import * as audio from './platform/audio';
import * as native from './platform/downloads';
import { reloadBook, useLibrary } from './player';
import { profileId } from './profile';
import { fileAccess } from './remote';

export type { DownloadLocation, DownloadStatus } from './platform/downloads';

const DOWNLOADS_KEY = ['downloads'];
const LOCATION_KEY = ['download-location'];
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
    t('Download while the phone sleeps'),
    t(
      'Android holds background work back while the screen is off. Let Lelap run in the background so a book can download overnight.',
    ),
    [
      { text: t('Not now'), style: 'cancel' },
      { text: t('Allow'), onPress: () => void native.requestBatteryExemption() },
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
    const row = getDownload(db, bookId);
    if (row?.state === 'failed') logDiagnostic(downloadFailureEvent(bookId, row.error));
    // A paused book picks up its new files now; a playing one at its next load.
    if (row?.state === 'done') await reloadBook(bookId, false).catch(() => {});
  }
  if (fold.changed.length > 0) onChange();
  // Books that moved to another folder: the old copies go once the player reads the new ones.
  // A book that is playing keeps them until it pauses; a reload then switches it over.
  for (const status of statuses.filter((s) => s.oldCopies && !fold.orphans.includes(s.bookId))) {
    const playing = await audio.getState().catch(() => null);
    if (playing?.bookId === status.bookId) {
      if (playing.playing) continue;
      await reloadBook(status.bookId, false).catch(() => {});
    }
    await native.releaseOld(status.bookId, status.location ?? null).catch(() => {});
  }
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

/**
 * Where downloads go. Polled while earlier downloads move there, and each poll folds the books
 * that have landed, so the player reads them from their new place.
 */
export function useDownloadLocation(): native.DownloadLocation | undefined {
  const query = useQuery({
    queryKey: LOCATION_KEY,
    queryFn: async () => {
      const location = await native.location();
      void queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY });
      return location;
    },
    refetchInterval: (q) => (q.state.data?.moving ? POLL_RUNNING_MS : false),
  });
  return query.data;
}

/** Android's folder picker for downloads; the ones already made move there in the background. */
export async function chooseDownloadFolder(): Promise<void> {
  if (await native.chooseLocation()) {
    await queryClient.invalidateQueries({ queryKey: LOCATION_KEY });
  }
}

/** Downloads go back inside Lelap; the ones in the chosen folder move back too. */
export async function resetDownloadFolder(): Promise<void> {
  await native.resetLocation();
  await queryClient.invalidateQueries({ queryKey: LOCATION_KEY });
}

/** How the download folder reads in Settings. */
export function describeLocation(location: native.DownloadLocation): string {
  const path = location.path ?? '';
  const where =
    location.uri === null
      ? t('Inside Lelap on the phone. Removed with the app and not seen by file managers.')
      : location.volume === 'removable'
        ? path
          ? t('{path} on the SD card.', { path })
          : t('The top of the SD card.')
        : path
          ? t('{path} on the phone.', { path })
          : t('The top of the phone’s storage.');
  if (!location.available) {
    return `${where} ${t('It can’t be reached. Put the SD card back, or choose another folder.')}`;
  }
  if (location.waiting === 0) return where;
  if (location.moving) {
    const left =
      location.waiting === 1
        ? t('Moving downloads: 1 left.')
        : t('Moving downloads: {n} left.', { n: location.waiting });
    return `${where} ${left}`;
  }
  return `${where} ${location.error ?? t('Some downloads are still in the old folder.')}`;
}

/** Keeps downloads folded in while the app runs and when it returns to the foreground. */
export function DownloadSync() {
  useDownloadStatuses();
  useDownloadLocation();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status !== 'active') return;
      // A move that stopped, or waited for an SD card, carries on.
      void native
        .resumeMove()
        .catch(() => {})
        .finally(() => void queryClient.invalidateQueries({ queryKey: LOCATION_KEY }));
      void queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY });
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
