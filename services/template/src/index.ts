import { Hono } from 'hono';

import { addon } from './addon';

// Hono leaves room for your own routes, such as a `/configure` page.
const app = new Hono();
app.all('*', (c) => addon.fetch(c.req.raw));

export default app;
