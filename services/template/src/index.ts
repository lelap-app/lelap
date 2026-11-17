import { Hono } from 'hono';

import { addon } from './addon';

// Hono leaves room for your own routes, such as a `/configure` page.
const app = new Hono();
// People open the base URL in a browser; the manifest is what they came for.
app.get('/', (c) => c.redirect('/manifest.json'));
app.all('*', (c) => addon.fetch(c.req.raw));

export default app;
