import { createApp } from '../../../services/proxy/src/app';
import { guardedFetch } from './guardedFetch';
import { memoryCache } from './memoryCache';
import { port, serve } from './serve';

// Private addresses stay refused unless PROXY_ALLOW_PRIVATE=true (feeds on your own network).
const app = createApp(
  {
    fetch: guardedFetch({ allowPrivate: process.env.PROXY_ALLOW_PRIVATE === 'true' }),
    cache: memoryCache(),
  },
  { ALLOW_ORIGIN: process.env.ALLOW_ORIGIN ?? '*' },
);
serve(app, port(8788), 'proxy');
