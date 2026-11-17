import { createApp } from './app';
import { d1Store } from './d1';
import { runUpkeep } from './expiry';

type Env = { DB: D1Database; SYNC_IDLE_EXPIRY_DAYS?: string };

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    return createApp(d1Store(env.DB)).fetch(request);
  },
  // The cron trigger in wrangler.toml.
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runUpkeep(d1Store(env.DB), env.SYNC_IDLE_EXPIRY_DAYS, Date.now()));
  },
} satisfies ExportedHandler<Env>;
