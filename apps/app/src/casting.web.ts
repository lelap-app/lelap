import { useSyncExternalStore } from 'react';

import { t } from './i18n';
import {
  addWebCastListener,
  promptWebCast,
  type WebCast,
  webCastState,
} from './platform/audio.web';
import type { CastDevice, CastSession, DiscoveryReport } from '@lelap/cast';
import type { CastGroup } from '@lelap/core';

// Casting in the web app (M125) goes through the browser: Chrome's Cast and Safari's AirPlay,
// with the Remote Playback API. The browser keeps the list of speakers and shows it, so the web
// Cast sheet (CastSheet.web.tsx) has one button for it; the rest of this API is Android's.

export type { CastDevice, CastSession, DiscoveryReport };
export const addDiscoveryListener: (listener: (report: DiscoveryReport) => void) => {
  remove: () => void;
} = () => ({ remove: () => {} });
export const isLocalNetworkDenied: (error: unknown) => boolean = () => false;
export type Casting = {
  device: CastSession | null;
  volume: number | null;
  error: string | null;
  untrusted: boolean;
  notice: string | null;
};

export const CASTING_SUPPORTED =
  typeof HTMLMediaElement !== 'undefined' && 'remote' in HTMLMediaElement.prototype;

// The browser doesn't say which speaker plays, only that one does.
const browserSession = (): CastSession => ({
  id: 'browser',
  name: t('Speaker or TV'),
  kind: 'cast',
  model: null,
  members: [],
});

let error: string | null = null;
let snapshot: Casting = { device: null, volume: null, error: null, untrusted: false, notice: null };
let cast: WebCast = webCastState();
const listeners = new Set<() => void>();

/** Brings the snapshot up to date; [changed] when `cast` itself changed. */
function refresh(changed = false): void {
  const connected = cast.state === 'connected';
  const same = connected === (snapshot.device !== null) && error === snapshot.error;
  if (!same) snapshot = { ...snapshot, device: connected ? browserSession() : null, error };
  if (!same || changed) for (const listener of listeners) listener();
}

addWebCastListener((next) => {
  cast = next;
  if (next.state !== 'disconnected') error = null;
  refresh(true);
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useCasting = (): Casting => useSyncExternalStore(subscribe, () => snapshot);

/** Whether the player offers the Cast tool: the browser can reach a speaker, or one plays. */
export const useCastAvailable = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => CASTING_SUPPORTED && (cast.available || cast.state !== 'disconnected'),
  );

/** Whether the browser is connecting to a speaker or plays there. */
export const useWebCast = (): WebCast => useSyncExternalStore(subscribe, () => cast);

/** The browser's own list of speakers, or its controls for the one that plays; call it from a tap. */
export async function chooseWebSpeaker(): Promise<void> {
  error = null;
  refresh();
  try {
    await promptWebCast();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    refresh();
  }
}

export const startDiscovery = async (): Promise<void> => {};
export const stopDiscovery = async (): Promise<void> => {};
export const listDevices = async (): Promise<CastDevice[]> => [];
export const addDevicesListener: (listener: (devices: CastDevice[]) => void) => {
  remove: () => void;
} = () => ({ remove: () => {} });
export const startCasting: (devices: CastDevice[], book: unknown) => Promise<void> = async () => {
  throw new Error(t('Casting needs the Android app.'));
};
export const joinSpeaker: (device: CastDevice) => Promise<void> = async () => {};
export const leaveSpeaker: (device: CastDevice) => Promise<void> = async () => {};
export const rememberedGroups = (): CastGroup[] => [];
export const forgetGroup: (ids: string[]) => void = () => {};
export const connectAnyway: (book: unknown) => Promise<void> = async () => {};
export const stopCasting = async (): Promise<void> => {};
export type LocalNetworkAccess = 'granted' | 'ask' | 'blocked';
export const localNetworkAccess = async (): Promise<LocalNetworkAccess> => 'granted';
export const requestLocalNetworkAccess = async (): Promise<LocalNetworkAccess> => 'granted';
export const setCastVolume: (level: number) => Promise<void> = async () => {};
