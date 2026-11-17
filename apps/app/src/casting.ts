import * as local from '@lelap/audio';
import type { BookLoad } from '@lelap/audio';
import * as cast from '@lelap/cast';
import type { CastDevice, LocalNetworkAccess } from '@lelap/cast';
import { useSyncExternalStore } from 'react';

// Casting on Android (M26, M50). The app connects to a receiver here; the playback service then
// makes the receiver its media session's player, so the player screen, the notification, the lock
// screen, headphones and Android Auto all control it, the sleep timer pauses it and Up Next goes
// on there. This file only follows which receiver plays, its volume and why a session ended.

export type { CastDevice, LocalNetworkAccess };

export const CASTING_SUPPORTED = true;
export const startDiscovery = cast.startDiscovery;
export const stopDiscovery = cast.stopDiscovery;
export const listDevices = cast.devices;
export const addDevicesListener = cast.addDevicesListener;
export const localNetworkAccess = cast.localNetworkAccess;
export const requestLocalNetworkAccess = cast.requestLocalNetworkAccess;

export type Casting = { device: CastDevice | null; volume: number | null; error: string | null };
let snapshot: Casting = { device: null, volume: null, error: null };
const listeners = new Set<() => void>();

function update(next: Partial<Casting>) {
  const merged = { ...snapshot, ...next };
  if (
    merged.device?.id === snapshot.device?.id &&
    merged.volume === snapshot.volume &&
    merged.error === snapshot.error
  ) {
    return;
  }
  snapshot = merged;
  for (const listener of listeners) listener();
}

cast.addStatusListener((status) => {
  if (status.deviceId !== snapshot.device?.id) return;
  if (status.state === 'closed' || status.state === 'lost') {
    update({ device: null, volume: null, error: status.error });
    return;
  }
  update({ volume: status.volume });
});

// A session that outlived the app's screen (the service kept casting) shows again on start.
void cast
  .session()
  .then((device) => {
    if (device && !snapshot.device) update({ device });
  })
  .catch(() => {});

/** The receiver playing now, its volume, and why the last session ended, if it failed. */
export function useCasting(): Casting {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** Plays [book] on [device] from where the phone is; the phone's player pauses. */
export async function startCasting(device: CastDevice, book: BookLoad): Promise<void> {
  const state = await local.getState();
  if (state.bookId !== book.bookId) await local.load(book, false);
  update({ error: null });
  try {
    await cast.connect(device.id);
    update({ device });
    await local.castTo();
  } catch (e) {
    update({ device: null, error: e instanceof Error ? e.message : String(e) });
    await cast.disconnect().catch(() => {});
    throw e;
  }
}

/** Hands the book back to the phone at the receiver's place; it plays on if it was playing. */
export async function stopCasting(): Promise<void> {
  if (!snapshot.device) return;
  await local.stopCasting();
  update({ device: null, volume: null });
}

export function setCastVolume(level: number): Promise<void> {
  update({ volume: level });
  return cast.setVolume(level);
}
