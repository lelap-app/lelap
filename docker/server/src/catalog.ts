import { createApp } from '../../../services/catalog/src/app';
import { guardedFetch } from './guardedFetch';
import { memoryCache } from './memoryCache';
import { port, serve } from './serve';

const app = createApp(
  {
    fetch: (url, init) => fetch(url, init),
    // The gPodder add-on reads feeds and servers listeners name; keep it off the private network
    // unless the operator allows it (a gPodder server on the same network).
    userFetch: guardedFetch({ allowPrivate: process.env.SCROBBLE_ALLOW_PRIVATE === 'true' }),
    cache: memoryCache(),
  },
  {
    SOURCE_URL: process.env.SOURCE_URL ?? 'https://github.com/lelap-app/lelap',
    ...(process.env.CONFIG_SECRET ? { CONFIG_SECRET: process.env.CONFIG_SECRET } : {}),
    // Podcast Index catalogs only when both are set, as on Workers.
    ...(process.env.PODCASTINDEX_KEY && process.env.PODCASTINDEX_SECRET
      ? {
          PODCASTINDEX_KEY: process.env.PODCASTINDEX_KEY,
          PODCASTINDEX_SECRET: process.env.PODCASTINDEX_SECRET,
        }
      : {}),
  },
);
serve(app, port(8787), 'catalog');
