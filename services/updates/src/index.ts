import type { Hono } from 'hono';

import { createApp, type Storage } from './app';

type Env = { BUCKET: R2Bucket };

const r2 = (bucket: R2Bucket): Storage => ({
  text: async (key) => (await bucket.get(key))?.text() ?? null,
  file: async (key) => (await bucket.get(key))?.body ?? null,
});

let app: Hono | undefined;

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    app ??= createApp(r2(env.BUCKET));
    return app.fetch(request);
  },
} satisfies ExportedHandler<Env>;
