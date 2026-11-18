import { createApp } from '../../../services/proxy/src/app';
import { adminFromEnv } from './admin';
import { guardedFetch } from './guardedFetch';
import { memoryCache } from './memoryCache';
import { port, serve } from './serve';

// Private addresses stay refused unless PROXY_ALLOW_PRIVATE=true (feeds on your own network).
const allowPrivate = process.env.PROXY_ALLOW_PRIVATE === 'true';
const allowOrigin = process.env.ALLOW_ORIGIN ?? '*';
const cache = memoryCache();
const app = createApp(
  { fetch: guardedFetch({ allowPrivate }), cache },
  { ALLOW_ORIGIN: allowOrigin },
);
const servicePort = port(8788);
serve(app, servicePort, 'proxy');
adminFromEnv('proxy', servicePort, {
  status: async () => ({
    checks: [],
    settings: [
      ['Allowed origin', allowOrigin],
      ['Private addresses', allowPrivate ? 'allowed' : 'refused'],
      ['Cached responses', String(cache.size)],
    ],
  }),
});
