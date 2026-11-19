import * as local from '@lelap/audio';
import type { BookLoad } from '@lelap/audio';
import * as cast from '@lelap/cast';
import type { CastDevice, CastSession, DiscoveryReport, LocalNetworkAccess } from '@lelap/cast';
import {
  type CastGroup,
  castEvent,
  forgetCastGroup,
  getSettings,
  rememberCastGroup,
  setSetting,
} from '@lelap/core';
import { useSyncExternalStore } from 'react';

import { db } from './db';
import { isDiagnosticsOn, logDiagnostic } from './diagnostics';
import { t } from './i18n';
import { profileId } from './profile';

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

/** Whether the player offers the Cast tool; the web app's depends on the browser (M125). */
export const useCastAvailable = (): boolean => true;

function update(next: Partial<Casting>) {
  const merged = { ...snapshot, ...next };
  if (
    // The same session may change its speakers (M125), so a new object counts as a change.
    merged.device === snapshot.device &&
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

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

cast.addStatusListener((status) => {
  if (status.deviceId !== snapshot.device?.id) return;
  if (status.state === 'closed' || status.state === 'lost') {
    update({ device: null, volume: null, error: status.error, untrusted: false, notice: null });
    return;
  }
  update({ volume: status.volume });
  // A speaker dropped out of the group (M125): show the ones that still play.
  const members = status.members;
  const device = snapshot.device;
  if (
    members &&
    device &&
    !sameIds(
      members,
      device.members.map((m) => m.id),
    )
  ) {
    void cast
      .session()
      .then((next) => {
        if (next && next.id === snapshot.device?.id) update({ device: next });
      })
      .catch(() => {});
  }
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

// The attempt that failed device authentication, for “Connect anyway”: a session's speakers, or
// a speaker that was to join the one playing.
let refused: { start: CastDevice[] } | { join: CastDevice } | null = null;

/** The speaker groups played on before (M125), newest first. */
export function rememberedGroups(): CastGroup[] {
  return getSettings(db, profileId).castGroups;
}

function remember(session: CastSession): void {
  if (session.members.length < 2) return;
  const ids = session.members.map((m) => m.id);
  setSetting(db, profileId, 'castGroups', rememberCastGroup(rememberedGroups(), ids), Date.now());
}

export function forgetGroup(ids: string[]): void {
  setSetting(db, profileId, 'castGroups', forgetCastGroup(rememberedGroups(), ids), Date.now());
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
    remember(session);
  } catch (e) {
    // Without local network access the sheet shows its explanation instead of an error line.
    const error = isLocalNetworkDenied(e) ? null : message(e);
    const untrusted = isUntrusted(e);
    if (untrusted) refused = { start: devices };
    update({ device: null, error, untrusted, notice: null });
    await cast.disconnect().catch(() => {});
    throw e;
  }
}

/**
 * Adds [device] to what plays now (M125): a single receiver becomes a group it leads. The new
 * speaker starts at the group's place and is kept in step.
 */
export async function joinSpeaker(device: CastDevice, anyway = false): Promise<void> {
  update({ error: null, untrusted: false, notice: null });
  refused = null;
  try {
    const session = await cast.join(device.id, anyway);
    update({ device: session });
    remember(session);
  } catch (e) {
    const error = isLocalNetworkDenied(e) ? null : message(e);
    const untrusted = isUntrusted(e);
    if (untrusted) refused = { join: device };
    // The session that played goes on without the speaker.
    update({ error, untrusted });
    throw e;
  }
}

/** Takes [device] out of the group that plays; it stops, and the others play on. */
export async function leaveSpeaker(device: CastDevice): Promise<void> {
  update({ error: null, untrusted: false, notice: null });
  try {
    const session = await cast.leave(device.id);
    update({ device: session });
    remember(session);
  } catch (e) {
    update({ error: message(e) });
    throw e;
  }
}

/**
 * Tries the attempt that failed device authentication again, letting in the speaker that was
 * refused; [book] is the one loaded now, for a session that had not started.
 */
export async function connectAnyway(book: BookLoad): Promise<void> {
  const last = refused;
  if (!last) return;
  if ('join' in last) await joinSpeaker(last.join, true);
  else await startCasting(last.start, book, true);
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
