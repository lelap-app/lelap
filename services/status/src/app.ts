import { Hono } from 'hono';

import { renderPage, toJson } from './page';
import type { Snapshot } from './store';

// No script, no outside requests: only the inline style may load.
const PAGE_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  // New results come every 5 minutes.
  'Cache-Control': 'public, max-age=60',
} as const;

/** The routes never ask the targets anything: if every service is down, the page still loads. */
export function createApp(snapshot: () => Promise<Snapshot | null>, now: () => number = Date.now) {
  const app = new Hono();
  app.get('/', async (c) => c.html(renderPage(await snapshot(), now()), 200, PAGE_HEADERS));
  app.get('/status.json', async (c) =>
    c.json(toJson(await snapshot(), now()), 200, {
      ...PAGE_HEADERS,
      'Access-Control-Allow-Origin': '*',
    }),
  );
  app.get('/health', (c) => c.json({ status: 'ok' }, 200, { 'Cache-Control': 'no-store' }));
  app.notFound((c) => c.text('Not found.', 404, { 'X-Content-Type-Options': 'nosniff' }));
  return app;
}
