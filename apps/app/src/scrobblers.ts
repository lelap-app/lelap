import {
  bundledAddons,
  installAddon,
  listAddons,
  loadAddonSettings,
  saveAddonSettings,
  scrobblerCall,
  splitLocalUrl,
} from '@lelap/core';
import {
  type Manifest,
  type ScrobbleEvent,
  ScrobbleRequest,
  scrobblesWithSettings,
  type Settings,
} from '@lelap/sdk';
import { Platform } from 'react-native';

import { codeFingerprint, sourceManifest } from './addonSources';
import { clientName, scrobblerStandIn } from './config';
import { db, newId } from './db';
import { t } from './i18n';
import { callAddonScrobble } from './sandbox';

// Scrobblers inside the app (M61, protocol revision 8), such as the Open Library reading log: set
// up with their settings under Settings → Add-ons, kept sealed on this device, and handed their
// events in a sandbox of their own instead of over HTTP.

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

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function call(url: string, manifest: Manifest, settings: Settings, events: ScrobbleEvent[]) {
  const { hosts, settings: given } = scrobblerCall(manifest, settings, {
    client: clientName,
    server: scrobblerStandIn,
  });
  return callAddonScrobble({
    addonUrl: url,
    hosts,
    settings: given,
    events,
  });
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

/** The settings a scrobbler has here, opened, to fill its form; passwords are left empty. */
export function scrobblerForm(url: string): { values: Settings; again: boolean } {
  const stored = loadAddonSettings(db, url, codeFingerprint(url));
  if (stored.state === 'none') return { values: {}, again: false };
  const manifest = sourceManifest(url);
  const plain: Settings = {};
  for (const field of manifest?.settings ?? []) {
    if (field.type !== 'password' && field.type !== 'signin')
      plain[field.key] = stored.settings[field.key] ?? '';
  }
  return { values: plain, again: stored.state === 'again' };
}

/**
 * Checks the settings with the add-on (a call without events signs in), then keeps them sealed and
 * installs the add-on so the outbox sends it events. Throws with the add-on's words on failure.
 */
export async function setUpScrobbler(url: string, settings: Settings): Promise<void> {
  const manifest = sourceManifest(url);
  if (!manifest || !scrobblesWithSettings(manifest))
    throw new Error(t('This add-on is not on this device.'));
  const result = await call(url, manifest, settings, []);
  if (result.status !== 200) {
    const said =
      typeof result.body === 'object' && result.body !== null && 'error' in result.body
        ? String(result.body.error)
        : null;
    throw new Error(said ?? t('The add-on answered {status}.', { status: result.status }));
  }
  saveAddonSettings(db, {
    url,
    manifest,
    settings,
    codeSha: codeFingerprint(url),
    now: Date.now(),
  });
  if (!listAddons(db).some((a) => a.url === url))
    installAddon(db, { url, manifest, now: Date.now(), newId });
}
