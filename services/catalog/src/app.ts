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
import { mountConfigurable } from './scrobble/mount';
import { BASE_PATH as OPEN_LIBRARY_LOG, openLibraryLogAddon } from './scrobble/openlibrary';
import { createSealer } from './scrobble/sealed';
import { createUpstream, type Platform } from './upstream';

/** Settings read from the environment (Wrangler vars and secrets, or process.env). */
export type Env = {
  PODCASTINDEX_KEY?: string;
  PODCASTINDEX_SECRET?: string;
  /** Where the source lives; it goes into the User-Agent sent upstream. */
  SOURCE_URL?: string;
  /**
   * At least 32 random characters. Seals listeners' tokens and keys into the Hardcover, gPodder
   * and Open Library reading log add-on URLs; without it those add-ons can't be configured. Changing it means everyone configures
   * them again.
   */
  CONFIG_SECRET?: string;
  /** Where the reading log add-on signs in; openlibrary.org unless testing against another. */
  OPEN_LIBRARY_URL?: string;
};

export function userAgent(env: Env): string {
  return env.SOURCE_URL ? `Lelap/1 (+${env.SOURCE_URL})` : 'Lelap/1';
}

export function podcastIndexCredentials(env: Env): PodcastIndexCredentials | null {
  const key = env.PODCASTINDEX_KEY?.trim();
  const secret = env.PODCASTINDEX_SECRET?.trim();
  return key && secret ? { key, secret } : null;
}

/**
 * The add-ons on one origin: the Catalog at the root, LibriVox under `/librivox` and the Internet
 * Archive under `/internet-archive`. Platform
 * calls are injected, so a Node entry only has to pass its own `fetch` (and no cache).
 */
export function createApp(platform: Platform, env: Env): Hono {
  const upstream = createUpstream(platform, userAgent(env));
  const librivox = createLibrivoxAddon(upstream);
  const internetArchive = createInternetArchiveAddon(upstream);
  const catalog = createCatalogAddon(upstream, podcastIndexCredentials(env));
  const agent = userAgent(env);
  // Never log a request or its body here: it may carry a listener's settings.
  const onError = (error: unknown) =>
    console.error(error instanceof Error ? error.message : 'Scrobble add-on failed');
  const hardcover = mountConfigurable(
    { ...hardcoverAddon(platform.fetch, agent), onError },
    createSealer(env.CONFIG_SECRET, 'hardcover'),
  );
  const gpodder = mountConfigurable(
    { ...gpodderAddon(platform.userFetch ?? platform.fetch, agent), onError },
    createSealer(env.CONFIG_SECRET, 'gpodder'),
  );
  const openLibraryLog = mountConfigurable(
    {
      ...openLibraryLogAddon(platform.fetch, agent, {
        ...(env.OPEN_LIBRARY_URL ? { base: env.OPEN_LIBRARY_URL.replace(/\/+$/, '') } : {}),
      }),
      onError,
    },
    createSealer(env.CONFIG_SECRET, 'openlibrary-log'),
  );

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
        ],
        configure: [
          manifest(`${HARDCOVER}/configure`),
          manifest(`${GPODDER}/configure`),
          manifest(`${OPEN_LIBRARY_LOG}/configure`),
        ],
      },
      200,
      CORS_HEADERS,
    );
  });
  for (const [path, serve] of [
    [HARDCOVER, hardcover],
    [GPODDER, gpodder],
    [OPEN_LIBRARY_LOG, openLibraryLog],
  ] as const) {
    app.all(path, (c) => serve(c.req.raw));
    app.all(`${path}/*`, (c) => serve(c.req.raw));
  }
  app.all(BASE_PATH, (c) => librivox.fetch(c.req.raw));
  app.all(INTERNET_ARCHIVE, (c) => internetArchive.fetch(c.req.raw));
  app.all(`${INTERNET_ARCHIVE}/*`, (c) => internetArchive.fetch(c.req.raw));
  app.all(`${BASE_PATH}/*`, (c) => librivox.fetch(c.req.raw));
  app.all('*', (c) => catalog.fetch(c.req.raw));
  return app;
}
