import type { Hono } from 'hono';

import { createApp, type Env } from './app';
import type { ResponseCache } from './upstream';

const workersCache = (): ResponseCache => ({
  match: async (key) => (await caches.default.match(key)) ?? undefined,
  put: (key, response) => caches.default.put(key, response),
});

// Built once per isolate: the environment does not change between requests.
let app: Hono | undefined;

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    app ??= createApp({ fetch: (url, init) => fetch(url, init), cache: workersCache() }, env);
    return app.fetch(request);
  },
} satisfies ExportedHandler<Env>;
