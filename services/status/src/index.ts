import { EmailMessage } from 'cloudflare:email';
import { DurableObject } from 'cloudflare:workers';

import { createApp } from './app';
import { checkAll, parseTargets } from './check';
import { rawMessage } from './email';
import { type Change, createStore, type Snapshot, type Store } from './store';

type Env = {
  STORE: DurableObjectNamespace<StatusStore>;
  TARGETS?: string;
  /** Only bound when the deploy sets STATUS_EMAIL_FROM (see wrangler.toml). */
  EMAIL?: SendEmail;
  STATUS_EMAIL_FROM?: string;
  /** A secret: a verified Email Routing destination address. */
  STATUS_EMAIL_TO?: string;
} & Record<string, unknown>;

/** One SQLite Durable Object holds every result and the last snapshot. */
export class StatusStore extends DurableObject<Env> {
  private readonly store: Store;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = createStore((query, ...params) =>
      ctx.storage.sql.exec(query, ...params).toArray(),
    );
  }

  record(results: Parameters<Store['record']>[0], now: number): Change[] {
    return this.store.record(results, now);
  }

  snapshot(): Snapshot | null {
    return this.store.snapshot();
  }
}

const storeOf = (env: Env) => env.STORE.get(env.STORE.idFromName('status'));

async function notify(env: Env, changes: Change[], now: number, page?: string) {
  const from = env.STATUS_EMAIL_FROM;
  const to = env.STATUS_EMAIL_TO;
  if (!env.EMAIL || !from || !to || !changes.length) return;
  try {
    await env.EMAIL.send(new EmailMessage(from, to, rawMessage(from, to, changes, now, page)));
  } catch (error) {
    // The page still has it; a failed message must not fail the run.
    console.error('status email failed', error);
  }
}

async function run(env: Env, now: number, page?: string) {
  const targets = parseTargets(env.TARGETS ?? '', env);
  const results = await checkAll((url, init) => fetch(url, init), targets);
  const changes = await storeOf(env).record(results, now);
  await notify(env, changes, now, page);
}

export default {
  async fetch(request, env) {
    const store = storeOf(env);
    return createApp(() => store.snapshot()).fetch(request);
  },
  // The Cron Trigger in wrangler.toml, every 5 minutes.
  scheduled(controller, env, ctx) {
    const domain = typeof env.STATUS_DOMAIN === 'string' ? env.STATUS_DOMAIN : '';
    ctx.waitUntil(run(env, controller.scheduledTime, domain ? `https://${domain}/` : undefined));
  },
} satisfies ExportedHandler<Env>;
