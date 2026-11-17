import type { lookup as dnsLookup } from 'node:dns';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../../services/proxy/src/app';
import { guardedFetch, isPrivateAddress } from './guardedFetch';

const FEED = '<?xml version="1.0"?><rss><channel><title>T</title></channel></rss>';

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/hop') {
      res.writeHead(302, { Location: '/feed.xml' }).end();
    } else if (req.url === '/feed.xml') {
      res.writeHead(200, { 'Content-Type': 'text/xml', 'Content-Encoding': 'gzip' });
      res.end(gzipSync(FEED));
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

/** A resolver that answers every name with one address, as a hostile DNS record would. */
const resolvesTo = (address: string) =>
  ((_host: string, _options: unknown, callback: (...args: unknown[]) => void) =>
    callback(null, [{ address, family: address.includes(':') ? 6 : 4 }])) as typeof dnsLookup;

function proxy(fetch: ReturnType<typeof guardedFetch>) {
  const app = createApp({ fetch }, {});
  return (path: string) => app.request(path);
}

describe('private addresses', () => {
  it('knows loopback, private, link-local and mapped addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a9fe:a9fe',
      'not an address',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ['93.184.215.14', '1.1.1.1', '2606:4700::1111', '172.32.0.1']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('refuses literal private addresses, names that resolve to them, and redirects there', async () => {
    const request = proxy(guardedFetch());
    const feed = (url: string) => request(`/feed?url=${encodeURIComponent(url)}`);
    expect((await feed(`http://127.0.0.1:${port}/feed.xml`)).status).toBe(403);
    expect((await feed(`http://[::ffff:127.0.0.1]:${port}/feed.xml`)).status).toBe(403);
    expect((await feed(`http://localhost:${port}/feed.xml`)).status).toBe(403);

    const hostile = proxy(guardedFetch({ resolve: resolvesTo('127.0.0.1') }));
    const response = await hostile(
      `/feed?url=${encodeURIComponent(`http://feeds.example.org:${port}/feed.xml`)}`,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'That address is on a private network.' });
  });

  it('fetches, follows redirects and decodes gzip when private addresses are allowed', async () => {
    const request = proxy(guardedFetch({ allowPrivate: true }));
    const response = await request(
      `/feed?url=${encodeURIComponent(`http://127.0.0.1:${port}/hop`)}`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(FEED);
  });
});
