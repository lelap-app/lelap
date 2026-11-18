import { createApp } from '../../../services/catalog/src/app';
import { adminFromEnv } from './admin';
import { guardedFetch } from './guardedFetch';
import { memoryCache } from './memoryCache';
import { secret } from './secrets';
import { port, serve } from './serve';

// From the environment, or generated once into SECRETS_DIR (the compose file's `secrets` volume).
const configSecret = secret('CONFIG_SECRET');
const podcastIndex = Boolean(process.env.PODCASTINDEX_KEY && process.env.PODCASTINDEX_SECRET);
const allowPrivate = process.env.SCROBBLE_ALLOW_PRIVATE === 'true';
const cache = memoryCache();
const app = createApp(
  {
    fetch: (url, init) => fetch(url, init),
    // The gPodder add-on reads feeds and servers listeners name; keep it off the private network
    // unless the operator allows it (a gPodder server on the same network).
    userFetch: guardedFetch({ allowPrivate }),
    cache,
  },
  {
    SOURCE_URL: process.env.SOURCE_URL ?? 'https://github.com/lelap-app/lelap',
    ...(configSecret ? { CONFIG_SECRET: configSecret } : {}),
    // Podcast Index catalogs only when both are set, as on Workers.
    ...(process.env.PODCASTINDEX_KEY && process.env.PODCASTINDEX_SECRET
      ? {
          PODCASTINDEX_KEY: process.env.PODCASTINDEX_KEY,
          PODCASTINDEX_SECRET: process.env.PODCASTINDEX_SECRET,
        }
      : {}),
  },
);
const servicePort = port(8787);
serve(app, servicePort, 'catalog');
// Whether settings are on, never their values.
adminFromEnv('catalog', servicePort, {
  status: async () => ({
    checks: [],
    settings: [
      ['Podcast Index', podcastIndex ? 'on' : 'off (no keys)'],
      [
        'Hardcover and gPodder set-up',
        configSecret && configSecret.length >= 32 ? 'on' : 'off (no CONFIG_SECRET)',
      ],
      ['gPodder servers on private networks', allowPrivate ? 'allowed' : 'refused'],
      ['Cached responses', String(cache.size)],
    ],
  }),
});
