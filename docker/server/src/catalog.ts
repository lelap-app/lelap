import { createApp } from '../../../services/catalog/src/app';
import { memoryCache } from './memoryCache';
import { port, serve } from './serve';

const app = createApp(
  { fetch: (url, init) => fetch(url, init), cache: memoryCache() },
  {
    SOURCE_URL: process.env.SOURCE_URL ?? 'https://github.com/lelap-app/lelap',
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
