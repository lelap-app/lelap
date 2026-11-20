import type { Hono } from 'hono';

import { createApp, type Env } from './app';
import { durableGrants } from './scrobble/hardcover-grants-do';
import type { ResponseCache } from './upstream';

export { HardcoverGrants } from './scrobble/hardcover-grants-do';

/** On Workers, Hardcover sign-ins live in Durable Objects (wrangler.toml). */
type WorkerEnv = Env & { HARDCOVER_GRANTS?: DurableObjectNamespace };

const workersCache = (): ResponseCache => ({
  match: async (key) => (await caches.default.match(key)) ?? undefined,
  put: (key, response) => caches.default.put(key, response),
});

// Built once per isolate: the environment does not change between requests.
let app: Hono | undefined;

export default {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Response | Promise<Response> {
    const namespace = env.HARDCOVER_GRANTS;
    app ??= createApp(
      {
        fetch: (url, init) => fetch(url, init),
        cache: workersCache(),
        ...(namespace ? { grants: () => durableGrants(namespace) } : {}),
      },
      env,
    );
    // The execution context reaches the add-ons, so their handlers' `waitUntil` outlives the answer.
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<WorkerEnv>;
