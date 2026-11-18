import {
  bundledAddons,
  CannotSealError,
  installAddon,
  keepOnHosts,
  listAddons,
  loadAddonSettings,
  saveAddonSettings,
  scrobblerCall,
  scrobblerStandIn,
  secretBox,
  splitLocalUrl,
} from '@lelap/core';
import {
  type Manifest,
  type ScrobbleEvent,
  ScrobbleRequest,
  scrobblesWithSettings,
  setUpWithSettings,
  type Settings,
} from '@lelap/sdk';
import { Platform } from 'react-native';

import { codeFingerprint, sourceManifest } from './addonSources';
import { clientName, scrobblerStandInSetting } from './config';
import { db, newId } from './db';
import { t } from './i18n';
import { callAddonScrobble, callAddonWithSettings } from './sandbox';

// Scrobblers inside the app (M61, protocol revision 8), such as the Open Library reading log: set
// up with their settings under Settings → Add-ons, kept sealed on this device, and handed their
// events in a sandbox of their own instead of over HTTP. Since revision 9 (M66) every add-on
// inside the app with settings and no library is set up the same way, and its settings reach all
// of its calls.

const CANNOT_SEAL = () =>
  t(
    'This phone’s key store isn’t working, so Lelap can’t keep the keys safe and didn’t save them. Restart the phone and try again.',
  );

/** Bundled scrobblers the listener can set up. */
export function bundledScrobblers(): { url: string; manifest: Manifest }[] {
  return bundledAddons()
    .filter((a) => scrobblesWithSettings(a.manifest))
    .map((a) => ({ url: a.url, manifest: a.manifest }));
}

/**
 * Whether scrobblers with a login can run here. Not in a browser: the reading log signs in with a
 * cookie, which a browser never shows to a page.
 */
export const scrobblersWork = Platform.OS !== 'web';

/** A sandbox's answer as HTTP; the add-on's `retryAfter` (seconds) becomes `Retry-After`. */
const answer = (status: number, body: unknown) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const wait =
    typeof body === 'object' && body !== null && 'retryAfter' in body ? body.retryAfter : null;
  if (typeof wait === 'number' && Number.isFinite(wait) && wait >= 0)
    headers['Retry-After'] = String(Math.round(wait));
  return new Response(JSON.stringify(body), { status, headers });
};

const given = (manifest: Manifest, settings: Settings) =>
  scrobblerCall(manifest, settings, {
    client: clientName,
    server: scrobblerStandIn(process.env.NODE_ENV, scrobblerStandInSetting),
  });

async function call(url: string, manifest: Manifest, settings: Settings, events: ScrobbleEvent[]) {
  const sandbox = given(manifest, settings);
  return callAddonScrobble({ addonUrl: url, ...sandbox, events });
}

/**
 * A call of an add-on set up with settings (revision 9), such as `catalog/audiobook/top.json`,
 * with its settings; null when it has none to hand over here, so the call goes without them.
 */
export async function callWithSettings(
  manifestUrl: string,
  path: string,
): Promise<{ status: number; body: unknown } | null> {
  if (!scrobblersWork) return null;
  const manifest = sourceManifest(manifestUrl);
  if (!manifest || !setUpWithSettings(manifest)) return null;
  const stored = loadAddonSettings(db, manifestUrl, codeFingerprint(manifestUrl));
  if (stored.state !== 'ok') return null;
  const sandbox = given(manifest, stored.settings);
  const result = await callAddonWithSettings({ addonUrl: manifestUrl, ...sandbox, path });
  // Nothing it answers may point off its hosts: the address could carry a setting away.
  return { status: result.status, body: keepOnHosts(result.body, sandbox.hosts) };
}

/**
 * The outbox's `POST /scrobble` for a `lelap-local://` add-on: the events go to its sandbox with
 * its settings. Settings this device can't open keep the events waiting (503) until they are
 * entered again; an add-on without settings is answered 401, so its events are dropped.
 */
export async function postLocalScrobble(url: string, body: string): Promise<Response> {
  const split = splitLocalUrl(url);
  const manifestUrl = split?.manifestUrl ?? url;
  const manifest = sourceManifest(manifestUrl);
  if (!manifest || !scrobblesWithSettings(manifest)) return answer(404, { error: 'Not found' });
  if (!scrobblersWork) return answer(503, { error: 'Not in a browser' });
  const stored = loadAddonSettings(db, manifestUrl, codeFingerprint(manifestUrl));
  if (stored.state === 'again') return answer(503, { error: 'Enter the settings again' });
  if (stored.state === 'none') return answer(401, { error: 'Not set up' });
  let events: ScrobbleEvent[];
  try {
    events = ScrobbleRequest.parse(JSON.parse(body)).events;
  } catch {
    return answer(400, { error: 'These are not scrobble events' });
  }
  const result = await call(manifestUrl, manifest, stored.settings, events);
  return answer(result.status, result.body);
}

/**
 * Whether the scrobbler's settings must be entered again (another phone, other code). The form
 * always starts empty: every field is sealed and never shown again.
 */
export function scrobblerForm(url: string): { values: Settings; again: boolean } {
  const stored = loadAddonSettings(db, url, codeFingerprint(url));
  return { values: {}, again: stored.state === 'again' };
}

/**
 * Checks the settings with a scrobbler (a call without events signs in), then keeps them sealed and
 * installs the add-on so the outbox sends it events and its calls get them. An add-on without
 * `scrobble` (revision 9) has no such check. Throws with the add-on's words on failure.
 */
export async function setUpScrobbler(url: string, settings: Settings): Promise<void> {
  const manifest = sourceManifest(url);
  if (!manifest || !setUpWithSettings(manifest))
    throw new Error(t('This add-on is not on this device.'));
  // Checked first, so keys that couldn't be kept are never sent either.
  if (!secretBox().sealing) throw new Error(CANNOT_SEAL());
  const result = scrobblesWithSettings(manifest)
    ? await call(url, manifest, settings, [])
    : { status: 200, body: null };
  if (result.status !== 200) {
    const said =
      typeof result.body === 'object' && result.body !== null && 'error' in result.body
        ? String(result.body.error)
        : null;
    throw new Error(said ?? t('The add-on answered {status}.', { status: result.status }));
  }
  try {
    saveAddonSettings(db, {
      url,
      manifest,
      settings,
      codeSha: codeFingerprint(url),
      now: Date.now(),
    });
  } catch (error) {
    if (error instanceof CannotSealError) throw new Error(CANNOT_SEAL(), { cause: error });
    throw error;
  }
  if (!listAddons(db).some((a) => a.url === url))
    installAddon(db, { url, manifest, now: Date.now(), newId });
}
