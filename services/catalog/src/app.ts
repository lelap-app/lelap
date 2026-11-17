import { CORS_HEADERS } from '@lelap/sdk';
import { Hono } from 'hono';

import { createCatalogAddon } from './catalog/addon';
import { BASE_PATH, createLibrivoxAddon } from './librivox/addon';
import type { PodcastIndexCredentials } from './podcastindex';
import { createUpstream, type Platform } from './upstream';

/** Settings read from the environment (Wrangler vars and secrets, or process.env). */
export type Env = {
  PODCASTINDEX_KEY?: string;
  PODCASTINDEX_SECRET?: string;
  /** Where the source lives; it goes into the User-Agent sent upstream. */
  SOURCE_URL?: string;
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
 * Both add-ons on one origin: the Catalog at the root and LibriVox under `/librivox`. Platform
 * calls are injected, so a Node entry only has to pass its own `fetch` (and no cache).
 */
export function createApp(platform: Platform, env: Env): Hono {
  const upstream = createUpstream(platform, userAgent(env));
  const librivox = createLibrivoxAddon(upstream);
  const catalog = createCatalogAddon(upstream, podcastIndexCredentials(env));

  const app = new Hono();
  // JSON only: never let a browser treat an answer as a page on this origin.
  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    c.res.headers.set('Referrer-Policy', 'no-referrer');
  });
  app.get('/', (c) => {
    const manifest = (path: string) => new URL(path, c.req.url).href;
    return c.json(
      {
        name: 'Lelap add-ons',
        addons: [manifest('/manifest.json'), manifest(`${BASE_PATH}/manifest.json`)],
      },
      200,
      CORS_HEADERS,
    );
  });
  app.all(BASE_PATH, (c) => librivox.fetch(c.req.raw));
  app.all(`${BASE_PATH}/*`, (c) => librivox.fetch(c.req.raw));
  app.all('*', (c) => catalog.fetch(c.req.raw));
  return app;
}
