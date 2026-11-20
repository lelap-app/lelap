import { type Context, Hono } from 'hono';

import { addon } from './addon';

// Hono leaves room for your own routes; the SDK already serves `/configure` and `/health`.
const app = new Hono();
// People open the base URL in a browser; the manifest is what they came for.
app.get('/', (c) => c.redirect('/manifest.json'));
// Handlers' `waitUntil` reaches the Workers execution context; elsewhere the work simply runs.
const contextOf = (c: Context) => {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
};
app.all('*', (c) => addon.fetch(c.req.raw, undefined, contextOf(c)));

export default app;
