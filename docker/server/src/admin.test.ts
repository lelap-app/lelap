import { describe, expect, it } from 'vitest';

import { createApp as catalogApp } from '../../../services/catalog/src/app';
import { createApp as proxyApp } from '../../../services/proxy/src/app';
import { createApp as syncApp } from '../../../services/sync/src/app';
import { createApp as updatesApp } from '../../../services/updates/src/app';
import { adminHandler, answers, isLocalAddress, type Status } from './admin';
import { memoryCache } from './memoryCache';

const TOKEN = 'a-token-of-twenty-chars';
const status = async (): Promise<Status> => ({
  checks: [{ name: 'Database', ok: true, detail: '<b>fine</b>' }],
  settings: [['Groups', '2']],
  tables: [{ title: 'Sync groups', columns: ['Group', 'Size'], rows: [['abcd1234…', '1 KB']] }],
});
const health = async () => [{ name: 'Port 8789', ok: true, detail: 'Answers with 404' }];
const get = (path: string, auth?: string) => ({
  method: 'GET',
  path,
  authorization: auth ?? null,
});
const basic = (password: string) => `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;

describe('admin page', () => {
  const handle = adminHandler({ service: 'sync', token: TOKEN, health, status, failDelayMs: 0 });

  it('needs the token, as Bearer or as the Basic auth password', async () => {
    const none = await handle(get('/'), '127.0.0.1');
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toContain('Basic');
    expect((await handle(get('/', 'Bearer wrong-token-of-twenty'), '127.0.0.1')).status).toBe(401);
    expect((await handle(get('/', basic('nope')), '127.0.0.1')).status).toBe(401);
    expect((await handle(get('/', 'Basic !!!'), '127.0.0.1')).status).toBe(401);
    expect((await handle(get('/', `Bearer ${TOKEN}`), '127.0.0.1')).status).toBe(200);
    expect((await handle(get('/', `bearer   ${TOKEN} `), '127.0.0.1')).status).toBe(200);
    expect((await handle(get('/', basic(TOKEN)), '10.0.0.4')).status).toBe(200);
  });

  it('answers local addresses only, unless remote access is allowed', async () => {
    for (const address of ['8.8.8.8', '2606:4700::1111', '', 'localhost']) {
      expect((await handle(get('/', `Bearer ${TOKEN}`), address)).status).toBe(403);
    }
    expect((await handle(get('/health'), '8.8.8.8')).status).toBe(403);
    expect(isLocalAddress('::1')).toBe(true);
    expect(isLocalAddress('::ffff:172.18.0.1')).toBe(true);
    expect(isLocalAddress('192.168.1.20')).toBe(true);
    // NAT64 carries the whole IPv4 internet, and documentation ranges are not callers.
    expect(isLocalAddress('64:ff9b::808:808')).toBe(false);
    expect(isLocalAddress('198.18.0.1')).toBe(false);
    expect(isLocalAddress('::ffff:8.8.8.8')).toBe(false);
    const open = adminHandler({
      service: 'sync',
      token: TOKEN,
      allowRemote: true,
      health,
      status,
      failDelayMs: 0,
    });
    expect((await open(get('/', `Bearer ${TOKEN}`), '8.8.8.8')).status).toBe(200);
    expect((await open(get('/'), '8.8.8.8')).status).toBe(401);
  });

  it('is off without a token or with a short one, except for /health', async () => {
    for (const token of [undefined, '', 'short-token']) {
      const off = adminHandler({ service: 'proxy', token, health, status });
      expect((await off(get('/', 'Bearer short-token'), '127.0.0.1')).status).toBe(404);
      expect((await off(get('/status.json'), '127.0.0.1')).status).toBe(404);
      expect((await off(get('/health'), '127.0.0.1')).status).toBe(200);
    }
  });

  it('says only ok or not on /health, without the token', async () => {
    const ok = await handle(get('/health'), '127.0.0.1');
    expect(await ok.json()).toEqual({ status: 'ok' });
    const failing = adminHandler({
      service: 'sync',
      token: TOKEN,
      health: async () => {
        throw new Error('database is locked');
      },
      status: async () => {
        throw new Error('no status');
      },
    });
    const bad = await failing(get('/health'), '127.0.0.1');
    expect(bad.status).toBe(503);
    expect(await bad.text()).not.toContain('locked');
    const detail = await failing(get('/status.json', `Bearer ${TOKEN}`), '127.0.0.1');
    const report = (await detail.json()) as { healthy: boolean; checks: { detail: string }[] };
    expect(report.healthy).toBe(false);
    expect(report.checks.map((c) => c.detail)).toEqual(['database is locked', 'no status']);
  });

  it('runs only the quick checks for /health, never the status', async () => {
    let asked = 0;
    const counted = adminHandler({
      service: 'sync',
      token: TOKEN,
      health,
      status: async () => {
        asked++;
        return { checks: [] };
      },
    });
    await counted(get('/health'), '127.0.0.1');
    expect(asked).toBe(0);
  });

  it('escapes what it shows and allows no scripts', async () => {
    const response = await handle(get('/', `Bearer ${TOKEN}`), '127.0.0.1');
    const html = await response.text();
    expect(html).toContain('&lt;b&gt;fine&lt;/b&gt;');
    expect(html).not.toContain('<b>fine');
    expect(html).not.toContain('<script');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('serves JSON for scripts and refuses anything but GET', async () => {
    const response = await handle(get('/status.json', `Bearer ${TOKEN}`), '::1');
    expect(await response.json()).toMatchObject({ service: 'sync', healthy: true, version: 'dev' });
    for (const method of ['POST', 'TRACE', 'CONNECT']) {
      expect((await handle({ ...get('/'), method }, '127.0.0.1')).status).toBe(405);
    }
    expect((await handle(get('/../etc/passwd', `Bearer ${TOKEN}`), '127.0.0.1')).status).toBe(404);
  });

  it('reports a service port that does not answer', async () => {
    const check = await answers(1, 500);
    expect(check.ok).toBe(false);
  });
});

describe('the services themselves', () => {
  // The admin page lives in the Node entries only, so the Workers (lelap.app) never serve it.
  it('have no admin routes on Cloudflare', async () => {
    const cache = memoryCache();
    const fetchNothing = async () => new Response(null, { status: 404 });
    const apps = [
      catalogApp({ fetch: fetchNothing, userFetch: fetchNothing, cache }, { SOURCE_URL: 'x' }),
      proxyApp({ fetch: fetchNothing, cache }, { ALLOW_ORIGIN: '*' }),
      syncApp({} as Parameters<typeof syncApp>[0]),
      updatesApp({ text: async () => null, file: async () => null }),
    ];
    for (const app of apps) {
      for (const path of ['/status.json', '/admin', '/health']) {
        const response = await app.request(path, { headers: { Authorization: `Bearer ${TOKEN}` } });
        const body = await response.text();
        expect(body).not.toContain('memoryBytes');
        expect(body).not.toContain('uptimeSeconds');
      }
    }
  });
});
