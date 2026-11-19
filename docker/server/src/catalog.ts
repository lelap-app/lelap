import { join } from 'node:path';

import { createApp } from '../../../services/catalog/src/app';
import { localGrants } from '../../../services/catalog/src/scrobble/hardcover-grants';
import { adminFromEnv } from './admin';
import { grantFiles } from './grantFiles';
import { guardedFetch } from './guardedFetch';
import { memoryCache } from './memoryCache';
import { secret } from './secrets';
import { port, serve } from './serve';

// From the environment, or generated once into SECRETS_DIR (the compose file's `secrets` volume).
const configSecret = secret('CONFIG_SECRET');
const podcastIndex = Boolean(process.env.PODCASTINDEX_KEY && process.env.PODCASTINDEX_SECRET);
const allowPrivate = process.env.SCROBBLE_ALLOW_PRIVATE === 'true';
const cache = memoryCache();
// Signing in to Hardcover (M92): the operator's own app at Hardcover; sign-ins are kept, sealed,
// next to CONFIG_SECRET in the secrets volume.
const hardcoverClientId = process.env.HARDCOVER_CLIENT_ID?.trim();
const hardcoverClientSecret = process.env.HARDCOVER_CLIENT_SECRET?.trim();
const grantsDir = process.env.SECRETS_DIR
  ? join(process.env.SECRETS_DIR, 'hardcover-grants')
  : undefined;
const hardcoverSignIn = Boolean(
  hardcoverClientId && hardcoverClientSecret && grantsDir && configSecret,
);
const app = createApp(
  {
    fetch: (url, init) => fetch(url, init),
    // The gPodder add-on reads feeds and servers listeners name; keep it off the private network
    // unless the operator allows it (a gPodder server on the same network).
    userFetch: guardedFetch({ allowPrivate }),
    cache,
    ...(grantsDir ? { grants: (refresh) => localGrants(grantFiles(grantsDir), refresh) } : {}),
  },
  {
    SOURCE_URL: process.env.SOURCE_URL ?? 'https://github.com/lelap-app/lelap',
    ...(configSecret ? { CONFIG_SECRET: configSecret } : {}),
    ...(process.env.APP_ORIGINS ? { APP_ORIGINS: process.env.APP_ORIGINS } : {}),
    // Behind Caddy or another proxy that ends TLS, requests arrive as http: Hardcover needs the
    // public https address, which the app also uses.
    CATALOG_ORIGIN:
      process.env.CATALOG_ORIGIN?.trim() ||
      `https://catalog.${process.env.LELAP_DOMAIN ?? 'localhost'}`,
    ...(hardcoverClientId && hardcoverClientSecret
      ? { HARDCOVER_CLIENT_ID: hardcoverClientId, HARDCOVER_CLIENT_SECRET: hardcoverClientSecret }
      : {}),
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
      [
        'Sign in with Hardcover',
        hardcoverSignIn ? 'on' : 'off (no HARDCOVER_CLIENT_ID and HARDCOVER_CLIENT_SECRET)',
      ],
      ['gPodder servers on private networks', allowPrivate ? 'allowed' : 'refused'],
      ['Cached responses', String(cache.size)],
    ],
  }),
});
