import { createApp } from '../../../services/proxy/src/app';
import { memoryCache } from './memoryCache';
import { port, serve } from './serve';

const app = createApp(
  { fetch: (url, init) => fetch(url, init), cache: memoryCache() },
  { ALLOW_ORIGIN: process.env.ALLOW_ORIGIN ?? '*' },
);
serve(app, port(8788), 'proxy');
