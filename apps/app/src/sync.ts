import {
  continueListening,
  createSyncClient,
  getBook,
  getMembership,
  joinWithCode,
  leaveSync,
  offerPairing,
  removedFromSync,
  resetSync,
  startSync,
  syncNow,
  type SyncResult,
} from '@lelap/core';
import { getRandomBytes } from 'expo-crypto';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { syncBase } from './config';
import { db, newId } from './db';
import { getState as playerState } from './platform/audio';
import { useLibrary, usePlayerState } from './player';
import { refreshPodcasts } from './podcasts';
import { profileId } from './profile';

const client = createSyncClient((url, init) => fetch(url, init), syncBase);
const random = (n: number) => getRandomBytes(n);

const SYNC_EVERY_MS = 60_000;
const PAUSE_SYNC_DELAY_MS = 2_000;
// A place another device saved is offered only when it differs this much from here.
const HANDOFF_MIN_MS = 30_000;

export const defaultDeviceName = () => (Platform.OS === 'web' ? 'Browser' : 'Android phone');

export const startSyncing = (name: string) => startSync(db, client, name, random, Date.now());
export const joinSyncing = (code: string, name: string) =>
  joinWithCode(db, client, code, name, random, Date.now());
export const makePairingCode = () => offerPairing(db, client, random);
export const stopSyncing = () => leaveSync(db);
export const resetSyncing = () => resetSync(db, client, random, Date.now());
/** Why this device stopped syncing by itself: a reset elsewhere, or a restored backup. */
export const removal = () => removedFromSync(db);
export const membership = () => getMembership(db);

/** The newest place from another device worth offering. */
export type Offer = { bookId: string; title: string; positionMs: number; deviceName: string };

let offer: Offer | null = null;
const listeners = new Set<() => void>();
const setOffer = (next: Offer | null) => {
  offer = next;
  for (const l of listeners) l();
};

export function useHandoffOffer(): [Offer | null, () => void] {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => offer,
  );
  return [current, () => setOffer(null)];
}

async function pickOffer(result: SyncResult): Promise<void> {
  const latest = result.handoffs
    .filter((h) => h.profileId === profileId)
    .sort((a, b) => b.at - a.at)[0];
  if (!latest) return;
  const state = await playerState();
  const next = continueListening(db, profileId);
  // Only for what this device is about to play: the loaded book or the Continue card.
  if (latest.bookId !== state.bookId && latest.bookId !== next?.id) return;
  if (state.bookId === latest.bookId) {
    const detail = getBook(db, profileId, latest.bookId);
    const before = detail?.files
      .slice(0, Math.max(0, state.partIndex))
      .reduce((sum, f) => sum + f.durationMs, 0);
    const here = (before ?? 0) + state.positionMs;
    if (state.playing || Math.abs(here - latest.bookPositionMs) < HANDOFF_MIN_MS) return;
  }
  const title = getBook(db, profileId, latest.bookId)?.book.title ?? '';
  setOffer({
    bookId: latest.bookId,
    title,
    positionMs: latest.bookPositionMs,
    deviceName: latest.deviceName,
  });
}

let running: Promise<SyncResult | null> | null = null;

/** Syncs once; overlapping calls share one run. */
export function syncOnce(): Promise<SyncResult | null> {
  if (!getMembership(db)) return Promise.resolve(null);
  running ??= syncNow(db, client, random, Date.now(), newId)
    .then(async (result) => {
      await pickOffer(result);
      // New subscriptions arrive without episodes; their feeds fill them in.
      if (result.pulled > 0) await refreshPodcasts(true).catch(() => {});
      return result;
    })
    .catch(() => null)
    .finally(() => {
      running = null;
    });
  return running;
}

/** Syncs on start, every minute while open, on return to the foreground and after a pause. */
export function SyncRunner() {
  const { refresh } = useLibrary();
  const { playing } = usePlayerState();
  useEffect(() => {
    const run = () => void syncOnce().then((r) => r && r.pulled > 0 && refresh());
    run();
    const timer = setInterval(run, SYNC_EVERY_MS);
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active' || status === 'background') run();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);
  // A moment after a pause, so the player has saved the paused place first.
  useEffect(() => {
    if (playing) return;
    const timer = setTimeout(() => void syncOnce(), PAUSE_SYNC_DELAY_MS);
    return () => clearTimeout(timer);
  }, [playing]);
  return null;
}
