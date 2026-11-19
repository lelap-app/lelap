import { AddonError, type Manifest, type ScrobbleEvent } from '@lelap/sdk';

import type { FetchLike } from '../upstream';
import type { ScrobbleAddon } from './mount';

// Episode actions for a gPodder-compatible server: gpodder.net's API 2, or the Nextcloud gPodder
// Sync app, which AntennaPod and other podcast apps also read. Listening becomes a `play` action
// with where it started and stopped, so the other apps continue at the same place.

export const BASE_PATH = '/gpodder';

export type GpodderFlavor = 'gpodder' | 'nextcloud';
export type GpodderConfig = {
  flavor: GpodderFlavor;
  /** The server's base URL, https only. */
  server: string;
  username: string;
  password: string;
};

export const gpodderManifest: Manifest = {
  id: 'app.lelap.gpodder',
  version: '1.1.0',
  protocol: 1,
  name: 'gPodder sync',
  description:
    'Reports the episodes you play to a gPodder-compatible server (gpodder.net or Nextcloud), so other podcast apps continue where you stopped.',
  types: ['episode'],
  resources: [{ name: 'scrobble', events: ['pause', 'progress', 'finish'] }],
  catalogs: [],
  configurable: true,
};

export function actionsUrl(config: GpodderConfig): string {
  const server = config.server.replace(/\/+$/, '');
  return config.flavor === 'nextcloud'
    ? `${server}/index.php/apps/gpoddersync/episode_action/create`
    : `${server}/api/2/episodes/${encodeURIComponent(config.username)}.json`;
}

/**
 * An https URL without credentials, query or fragment. Private addresses are refused where the
 * request is made (Workers can't reach them; the Node server guards its fetch).
 */
export function serverUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AddonError(400, 'Enter the server address, such as https://gpodder.net.');
  }
  if (url.protocol !== 'https:') throw new AddonError(400, 'The server must use https.');
  if (url.username || url.password || url.search || url.hash)
    throw new AddonError(400, 'Enter only the server address, without a login or query.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** UTC without a zone suffix, as the gPodder API writes it. */
const timestamp = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const seconds = (ms: number) => Math.round(ms / 1000);

type Action = {
  podcast: string;
  episode: string;
  guid?: string;
  action: 'play';
  timestamp: string;
  started: number;
  position: number;
  total: number;
};

const decodeXml = (text: string) =>
  text
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/**
 * The enclosure URL of each item in an RSS feed, by `guid` (or by the enclosure URL itself for
 * items without one, as the app does). The app never sends audio URLs, so the add-on reads the
 * public feed for the `episode` field the gPodder API asks for.
 */
export function enclosuresByGuid(xml: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, item = ''] of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const enclosure = /<enclosure\b[^>]*\burl\s*=\s*("([^"]*)"|'([^']*)')/i.exec(item);
    const url = enclosure ? decodeXml(enclosure[2] ?? enclosure[3] ?? '') : '';
    if (!/^https?:\/\//i.test(url)) continue;
    const guid = /<guid\b[^>]*>([\s\S]*?)<\/guid>/i.exec(item)?.[1];
    found.set(guid ? decodeXml(guid) : url, url);
  }
  return found;
}

async function readFeed(fetch: FetchLike, feed: string, userAgent: string): Promise<string | null> {
  let url = feed;
  // Feeds move; follow a few redirects by hand (the guarded Node fetch does not).
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': userAgent,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > 20_000_000 ? null : text;
  }
  return null;
}

/** The play actions for a batch: one per pause, progress or finish whose episode is found. */
export async function playActions(
  fetch: FetchLike,
  events: ScrobbleEvent[],
  userAgent: string,
): Promise<Action[]> {
  const feeds = new Map<string, Promise<Map<string, string>>>();
  const actions: Action[] = [];
  for (const event of events) {
    const { item } = event;
    const feed = item.podcast?.feed;
    const guid = item.episodeGuid;
    // gPodder needs where playing started, stopped and the length; `start` has none of that yet.
    if (item.type !== 'episode' || !feed || !guid) continue;
    if (event.event !== 'pause' && event.event !== 'progress' && event.event !== 'finish') continue;
    const total = item.durationMs;
    if (!total || event.positionMs === undefined) continue;
    if (!feeds.has(feed))
      feeds.set(
        feed,
        readFeed(fetch, feed, userAgent)
          .then((xml) => (xml ? enclosuresByGuid(xml) : new Map<string, string>()))
          .catch(() => new Map<string, string>()),
      );
    const episode = (await feeds.get(feed))?.get(guid);
    if (!episode) continue;
    const position = Math.min(seconds(event.positionMs), seconds(total));
    actions.push({
      podcast: feed,
      episode,
      guid,
      action: 'play',
      timestamp: timestamp(event.at),
      started: Math.min(seconds(event.sessionStartMs ?? event.positionMs), position),
      position,
      total: seconds(total),
    });
  }
  return actions;
}

async function upload(fetch: FetchLike, config: GpodderConfig, body: unknown, userAgent: string) {
  const basic = btoa(
    String.fromCharCode(...new TextEncoder().encode(`${config.username}:${config.password}`)),
  );
  const response = await fetch(actionsUrl(config), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403)
    throw new AddonError(401, 'The server did not accept the login; configure the add-on again');
  if (response.status === 404)
    throw new AddonError(400, 'The server has no gPodder episode actions at this address');
  if (!response.ok) throw new AddonError(502, `The gPodder server answered ${response.status}`);
}

/** Settings from the SDK's config or a sealed link from before M102; null when they don't fit. */
export function reviveGpodder(value: unknown): GpodderConfig | null {
  const v = value as Partial<Record<keyof GpodderConfig, unknown>> | null;
  if (!v || typeof v.server !== 'string' || typeof v.username !== 'string') return null;
  if (typeof v.password !== 'string' || !v.username.trim() || !v.password) return null;
  let server: string;
  try {
    server = serverUrl(v.server);
  } catch {
    return null;
  }
  return {
    flavor: v.flavor === 'nextcloud' ? 'nextcloud' : 'gpodder',
    server,
    username: v.username.trim(),
    password: v.password,
  };
}

export function gpodderAddon(fetch: FetchLike, userAgent: string): ScrobbleAddon<GpodderConfig> {
  return {
    basePath: BASE_PATH,
    manifest: gpodderManifest,
    text: {
      intro:
        'Enter the gPodder-compatible server that keeps your podcast places, such as gpodder.net or your Nextcloud with the gPodder Sync app. Use an app password where the server offers one.',
    },
    fields: [
      {
        key: 'flavor',
        label: 'Server type',
        type: 'select',
        required: true,
        options: [
          { value: 'gpodder', label: 'gpodder.net API (also mygpo and compatible servers)' },
          { value: 'nextcloud', label: 'Nextcloud gPodder Sync' },
        ],
      },
      {
        key: 'server',
        label: 'Server address',
        type: 'url',
        required: true,
        placeholder: 'https://gpodder.net',
      },
      { key: 'username', label: 'User name', type: 'text', required: true },
      { key: 'password', label: 'Password or app password', type: 'password', required: true },
    ],
    parse: (form) => {
      const server = serverUrl(typeof form.server === 'string' ? form.server : '');
      const config = reviveGpodder({ ...form, server });
      if (!config) throw new AddonError(400, 'Enter a user name and password.');
      return config;
    },
    revive: reviveGpodder,
    store: (config) => ({ ...config }),
    check: async (config) => {
      // An empty upload checks the address and the login without recording anything.
      await upload(fetch, config, [], userAgent);
    },
    handlers: (config) => ({
      scrobble: async ({ events }) => {
        const actions = await playActions(fetch, events, userAgent);
        if (actions.length > 0) await upload(fetch, config, actions, userAgent);
      },
    }),
  };
}
