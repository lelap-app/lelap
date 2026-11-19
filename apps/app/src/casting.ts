import * as local from '@lelap/audio';
import type { BookLoad } from '@lelap/audio';
import * as cast from '@lelap/cast';
import type { CastDevice, CastSession, DiscoveryReport, LocalNetworkAccess } from '@lelap/cast';
import { castEvent } from '@lelap/core';
import { useSyncExternalStore } from 'react';

import { isDiagnosticsOn, logDiagnostic } from './diagnostics';
import { t } from './i18n';

// Casting on Android (M26, M50). The app connects to a receiver here; the playback service then
// makes the receiver its media session's player, so the player screen, the notification, the lock
// screen, headphones and Android Auto all control it, the sleep timer pauses it and Up Next goes
// on there. This file only follows which receiver plays, its volume and why a session ended.

export type { CastDevice, CastSession, DiscoveryReport, LocalNetworkAccess };

export const CASTING_SUPPORTED = true;
export const startDiscovery = cast.startDiscovery;
export const listDevices = cast.devices;
export const addDevicesListener = cast.addDevicesListener;
export const addDiscoveryListener = cast.addDiscoveryListener;

/** Ends the search and moves what it did into the diagnostics log (kinds, codes, counts). */
export async function stopDiscovery(): Promise<void> {
  await cast.stopDiscovery();
  // Taken even with the log off, so the module's list never grows.
  const events = await cast.takeDiagnostics().catch(() => []);
  if (!isDiagnosticsOn()) return;
  for (const raw of events) {
    const parsed = castEvent(raw);
    if (parsed) logDiagnostic(parsed.event, parsed.at);
  }
}

/** A `connect()` refused because Android 17's local network access is off. */
export function isLocalNetworkDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === cast.LOCAL_NETWORK_DENIED
  );
}
export const localNetworkAccess = cast.localNetworkAccess;
export const requestLocalNetworkAccess = cast.requestLocalNetworkAccess;

/** A `connect()` refused because a Google Cast speaker failed device authentication (M78). */
function isUntrusted(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === cast.CAST_UNTRUSTED
  );
}

/**
 * The receiver or group playing now, its volume, and why the last attempt failed. `untrusted`:
 * that attempt failed device authentication, and `connectAnyway()` may try it again. `notice`:
 * speakers of a group that couldn't be reached.
 */
export type Casting = {
  device: CastSession | null;
  volume: number | null;
  error: string | null;
  untrusted: boolean;
  notice: string | null;
};
let snapshot: Casting = { device: null, volume: null, error: null, untrusted: false, notice: null };
const listeners = new Set<() => void>();

function update(next: Partial<Casting>) {
  const merged = { ...snapshot, ...next };
  if (
    merged.device?.id === snapshot.device?.id &&
    merged.volume === snapshot.volume &&
    merged.error === snapshot.error &&
    merged.untrusted === snapshot.untrusted &&
    merged.notice === snapshot.notice
  ) {
    return;
  }
  snapshot = merged;
  for (const listener of listeners) listener();
}

cast.addStatusListener((status) => {
  if (status.deviceId !== snapshot.device?.id) return;
  if (status.state === 'closed' || status.state === 'lost') {
    update({ device: null, volume: null, error: status.error, untrusted: false, notice: null });
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

/** The receiver or group playing now, its volume, and why the last session ended, if it failed. */
export function useCasting(): Casting {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

// The speakers of the attempt that failed device authentication, for “Connect anyway”.
let refused: CastDevice[] | null = null;

/**
 * Plays [book] on [devices] from where the phone is: one receiver, or several kept in step as a
 * group led by the first (M78). The phone's player pauses.
 */
export async function startCasting(
  devices: CastDevice[],
  book: BookLoad,
  anyway = false,
): Promise<void> {
  const state = await local.getState();
  if (state.bookId !== book.bookId) await local.load(book, false);
  update({ error: null, untrusted: false, notice: null });
  refused = null;
  try {
    const { session, unreached } = await cast.connect(
      devices.map((d) => d.id),
      anyway,
    );
    update({
      device: session,
      notice:
        unreached.length === 0
          ? null
          : t('Couldn’t reach {names}; the others play.', { names: unreached.join(', ') }),
    });
    await local.castTo();
  } catch (e) {
    // Without local network access the sheet shows its explanation instead of an error line.
    const error = isLocalNetworkDenied(e) ? null : e instanceof Error ? e.message : String(e);
    const untrusted = isUntrusted(e);
    if (untrusted) refused = devices;
    update({ device: null, error, untrusted, notice: null });
    await cast.disconnect().catch(() => {});
    throw e;
  }
}

/**
 * Tries the speakers that failed device authentication again with [book] (the one loaded now),
 * letting in the speaker that was refused.
 */
export async function connectAnyway(book: BookLoad): Promise<void> {
  const devices = refused;
  if (!devices) return;
  await startCasting(devices, book, true);
}

/** Hands the book back to the phone at the receiver's place; it plays on if it was playing. */
export async function stopCasting(): Promise<void> {
  if (!snapshot.device) return;
  await local.stopCasting();
  update({ device: null, volume: null, notice: null });
}

export function setCastVolume(level: number): Promise<void> {
  update({ volume: level });
  return cast.setVolume(level);
}
