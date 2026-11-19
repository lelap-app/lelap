import { CORS_HEADERS } from '@lelap/sdk';
import { Hono } from 'hono';

import { createCatalogAddon } from './catalog/addon';
import {
  BASE_PATH as INTERNET_ARCHIVE,
  createInternetArchiveAddon,
} from './internet-archive/addon';
import { BASE_PATH, createLibrivoxAddon } from './librivox/addon';
import type { PodcastIndexCredentials } from './podcastindex';
import { BASE_PATH as GPODDER, gpodderAddon } from './scrobble/gpodder';
import { BASE_PATH as HARDCOVER, hardcoverAddon } from './scrobble/hardcover';
import { serveScrobbleAddon } from './scrobble/mount';
import { createSealer } from './scrobble/sealed';
import { BASE_PATH as SERIES, createSeriesAddon } from './series/addon';
import { createUpstream, type Platform } from './upstream';

/** Settings read from the environment (Wrangler vars and secrets, or process.env). */
export type Env = {
  PODCASTINDEX_KEY?: string;
  PODCASTINDEX_SECRET?: string;
  /** Where the source lives; it goes into the User-Agent sent upstream. */
  SOURCE_URL?: string;
  /**
   * At least 32 random characters. Seals listeners' tokens into the Hardcover and gPodder add-on
   * URLs; without it those add-ons can't be configured. Changing it means everyone configures
   * them again.
   */
  CONFIG_SECRET?: string;
  /**
   * Web builds of the app the configure pages may hand the add-on address back to, at
   * `<origin>/addon`, separated by commas, such as `https://listen.example.org`.
   */
  APP_ORIGINS?: string;
};

/** The web app origins in `APP_ORIGINS`, https only. */
export function returnOrigins(env: Env): string[] {
  return (env.APP_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o));
}

export function userAgent(env: Env): string {
  return env.SOURCE_URL ? `Lelap/1 (+${env.SOURCE_URL})` : 'Lelap/1';
}

export function podcastIndexCredentials(env: Env): PodcastIndexCredentials | null {
  const key = env.PODCASTINDEX_KEY?.trim();
  const secret = env.PODCASTINDEX_SECRET?.trim();
  return key && secret ? { key, secret } : null;
}

/**
 * The add-ons on one origin: the Catalog at the root, LibriVox under `/librivox`, the Internet
 * Archive under `/internet-archive` and whole series under `/series`. Platform
 * calls are injected, so a Node entry only has to pass its own `fetch` (and no cache).
 */
export function createApp(platform: Platform, env: Env): Hono {
  const upstream = createUpstream(platform, userAgent(env));
  const librivox = createLibrivoxAddon(upstream);
  const internetArchive = createInternetArchiveAddon(upstream);
  const series = createSeriesAddon(upstream);
  const catalog = createCatalogAddon(upstream, podcastIndexCredentials(env));
  const agent = userAgent(env);
  // Never log a request or its body here: it may carry a listener's settings.
  const onError = (error: unknown) =>
    console.error(error instanceof Error ? error.message : 'Scrobble add-on failed');
  const shared = {
    secret: env.CONFIG_SECRET,
    onError,
    ...(platform.now ? { now: platform.now } : {}),
    ...(returnOrigins(env).length > 0 ? { returnOrigins: returnOrigins(env) } : {}),
  };
  // On the SDK's configure since M102; links sealed before it (`v1.`) still open.
  const hardcover = serveScrobbleAddon(
    hardcoverAddon(platform.fetch, agent, platform.cache, env.CONFIG_SECRET),
    { ...shared, legacy: createSealer(env.CONFIG_SECRET, 'hardcover') },
  );
  const gpodder = serveScrobbleAddon(gpodderAddon(platform.userFetch ?? platform.fetch, agent), {
    ...shared,
    legacy: createSealer(env.CONFIG_SECRET, 'gpodder'),
  });

  const app = new Hono();
  // JSON only: never let a browser treat an answer as a page on this origin.
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    // The configure pages set their own, which also allows their form and styles.
    if (!c.res.headers.has('Content-Security-Policy'))
      c.res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    c.res.headers.set('Referrer-Policy', 'no-referrer');
  });
  app.get('/', (c) => {
    const manifest = (path: string) => new URL(path, c.req.url).href;
    return c.json(
      {
        name: 'Lelap add-ons',
        addons: [
          manifest('/manifest.json'),
          manifest(`${BASE_PATH}/manifest.json`),
          manifest(`${INTERNET_ARCHIVE}/manifest.json`),
          manifest(`${SERIES}/manifest.json`),
        ],
        configure: [manifest(`${HARDCOVER}/configure`), manifest(`${GPODDER}/configure`)],
      },
      200,
      CORS_HEADERS,
    );
  });
  for (const [path, serve] of [
    [HARDCOVER, hardcover],
    [GPODDER, gpodder],
  ] as const) {
    app.all(path, (c) => serve(c.req.raw));
    app.all(`${path}/*`, (c) => serve(c.req.raw));
  }
  app.all(BASE_PATH, (c) => librivox.fetch(c.req.raw));
  app.all(INTERNET_ARCHIVE, (c) => internetArchive.fetch(c.req.raw));
  app.all(`${INTERNET_ARCHIVE}/*`, (c) => internetArchive.fetch(c.req.raw));
  app.all(SERIES, (c) => series.fetch(c.req.raw));
  app.all(`${SERIES}/*`, (c) => series.fetch(c.req.raw));
  app.all(`${BASE_PATH}/*`, (c) => librivox.fetch(c.req.raw));
  app.all('*', (c) => catalog.fetch(c.req.raw));
  return app;
}
