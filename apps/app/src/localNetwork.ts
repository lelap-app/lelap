import {
  addonSourceHosts,
  isLocalRemote,
  type LocalNetworkAccess,
  localNetworkCause,
  localNetworkStep,
  type RemoteSource,
} from '@lelap/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';

import { sourceManifest } from './addonSources';
import { localNetworkAccess, requestLocalNetworkAccess } from './casting';
import { showAlert } from './dialog';
import { t } from './i18n';

// Android 17 lets Lelap reach the home network only with the local network permission (Android
// shows it as “nearby devices”), also at target 36. Casting asks in its sheet; library servers at
// a LAN address ask here, in the flows the listener starts: adding or testing a server, Settings'
// server rows, playing and downloading. A scan that runs by itself never asks; it marks the server.
// The permission is the cast module's (`localNetworkAccess`), so the web and Android 16 and older
// always answer `granted`.

/** Access now; `granted` where the phone can't say, so nothing is held back by mistake. */
export function currentLocalNetworkAccess(): Promise<LocalNetworkAccess> {
  return localNetworkAccess().catch(() => 'granted' as const);
}

/** Whether a server is on the local network, an add-on's by the hosts it may reach. */
export function isLocalServer(remote: RemoteSource): boolean {
  if (remote.type !== 'addon') return isLocalRemote(remote);
  const manifest = sourceManifest(remote.addonUrl);
  return isLocalRemote(remote, manifest ? addonSourceHosts(manifest, remote.settings) : []);
}

const ask = (title: string, message: string, allow: string): Promise<boolean> =>
  new Promise((resolve) =>
    showAlert(
      title,
      message,
      [
        { text: t('Not now'), style: 'cancel', onPress: () => resolve(false) },
        { text: allow, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );

/**
 * Before reaching a server on the local network ([local]): explains, then shows Android's prompt,
 * or, when it was turned down for good, offers Android's settings. True once access is on.
 */
export async function askLocalNetwork(local: boolean): Promise<boolean> {
  const step = localNetworkStep(local, await currentLocalNetworkAccess());
  if (step === 'go') return true;
  if (step === 'explain') {
    const go = await ask(
      t('Allow local network access'),
      t(
        'This server is on your home network. To reach it, Lelap needs Android’s “nearby devices” permission. Lelap only connects to the servers you add.',
      ),
      t('Allow'),
    );
    if (!go) return false;
    const answer = await requestLocalNetworkAccess().catch(() => 'blocked' as const);
    if (answer === 'granted') {
      clearNeedsLocalNetwork();
      return true;
    }
    // Turned down once: Android asks again next time.
    if (answer === 'ask') return false;
  }
  if (await ask(t('Local network access is off'), BLOCKED(), t('Open settings'))) {
    void Linking.openSettings();
  }
  return false;
}

const BLOCKED = () =>
  t(
    '“Nearby devices” is off for Lelap, so it can’t reach servers on your home network. Turn it on in Android’s settings.',
  );

/**
 * A failed connection's message, with missing access named as its cause: for certain when the
 * server is on the local network, as a possibility otherwise (a public name may lead home).
 */
export async function withLocalNetworkCause(message: string, local: boolean): Promise<string> {
  const cause = localNetworkCause(local, await currentLocalNetworkAccess());
  if (cause === 'none') return message;
  const line =
    cause === 'certain'
      ? BLOCKED()
      : t(
          'If this server is on your home network, Lelap needs Android’s “nearby devices” permission to reach it.',
        );
  return message ? `${message}\n\n${line}` : line;
}

// Servers a scan skipped for want of access, by root ID. Kept in memory: the next scan checks again.
let needing: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function setNeeding(next: ReadonlySet<string>) {
  needing = next;
  for (const listener of listeners) listener();
}

/** Marks or clears a server a background scan skipped because access is off. */
export function markNeedsLocalNetwork(rootId: string, on: boolean): void {
  if (needing.has(rootId) === on) return;
  const next = new Set(needing);
  if (on) next.add(rootId);
  else next.delete(rootId);
  setNeeding(next);
}

function clearNeedsLocalNetwork(): void {
  if (needing.size > 0) setNeeding(new Set());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The servers that need local network access before they can be scanned. */
export function useNeedsLocalNetwork(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => needing,
    () => needing,
  );
}

/**
 * Why playback failed, when [failed] streams from the local network and access is off: the line
 * the player shows under its error. Null otherwise.
 */
export function useLocalNetworkCause(failed: boolean): string | null {
  const [cause, setCause] = useState<string | null>(null);
  useEffect(() => {
    if (!failed) {
      setCause(null);
      return;
    }
    let live = true;
    void currentLocalNetworkAccess().then((access) => {
      if (live) setCause(localNetworkCause(true, access) === 'none' ? null : BLOCKED());
    });
    return () => {
      live = false;
    };
  }, [failed]);
  return cause;
}
