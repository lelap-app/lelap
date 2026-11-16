import { createApp } from './app';
import { d1Store } from './d1';

type Env = { DB: D1Database };

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    return createApp(d1Store(env.DB)).fetch(request);
  },
} satisfies ExportedHandler<Env>;
