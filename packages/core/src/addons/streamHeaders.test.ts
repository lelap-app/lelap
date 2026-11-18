import { randomBytes } from 'node:crypto';

import type { Manifest, Stream } from '@lelap/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { exportLibrary } from '../backup';
import { streamHeaders } from '../schema';
import { createSecretBox, plainBox, setSecretBox } from '../secrets';
import { collectOps } from '../sync/ops';
import { type Fetcher, fetchAddonStreams, type InstalledAddon } from './client';
import { addStreamedBook, removeStreamedBook } from './streamed';
import { forgetStreamHeaders, streamHeadersFor } from './streamHeaders';

const random = (n: number) => new Uint8Array(randomBytes(n));
let n = 0;
const newId = () => `id-${++n}`;

const TOKEN = 'Bearer very-secret-token';
const LOCAL = 'lelap-local://org.example.home/manifest.json';
const OTHER = 'lelap-local://org.example.other/manifest.json';
const WEB = 'https://addon.example/manifest.json';
const HOSTS: Record<string, string[]> = { [LOCAL]: ['nas.local:8080'], [OTHER]: ['evil.example'] };
const hostsOf = (url: string) => HOSTS[url] ?? null;

const meta = { id: 'home:dune', type: 'audiobook' as const, name: 'Dune' };
const stream = (url = 'http://nas.local:8080/dune.mp3'): Stream => ({
  sourceKey: 'home:dune',
  name: 'Home',
  url,
  durationMs: 1000,
  headers: { Authorization: TOKEN },
});

afterEach(() => setSecretBox(plainBox));

describe('stream headers', () => {
  it('keeps a login from an add-on inside the app, sealed, and sends it to its hosts only', () => {
    setSecretBox(createSecretBox(random(32), random));
    const db = createTestDb();
    const bookId = addStreamedBook(db, { addonUrl: LOCAL, meta, stream: stream(), now: 1, newId });
    expect(JSON.stringify(db.select().from(streamHeaders).all())).not.toContain('very-secret');
    expect(streamHeadersFor(db, bookId, 'http://nas.local:8080/dune.mp3', hostsOf)).toEqual({
      Authorization: TOKEN,
    });
    expect(streamHeadersFor(db, bookId, 'http://evil.example/dune.mp3', hostsOf)).toEqual({});
    expect(streamHeadersFor(db, bookId, 'http://nas.local:8080/dune.mp3', () => null)).toEqual({});
  });

  it('forgets an add-on’s logins when another file takes its place', () => {
    const db = createTestDb();
    const bookId = addStreamedBook(db, { addonUrl: LOCAL, meta, stream: stream(), now: 1, newId });
    forgetStreamHeaders(db, LOCAL);
    expect(streamHeadersFor(db, bookId, 'http://nas.local:8080/dune.mp3', hostsOf)).toEqual({});
  });

  it('never keeps headers from a web add-on', () => {
    const db = createTestDb();
    const bookId = addStreamedBook(db, { addonUrl: WEB, meta, stream: stream(), now: 1, newId });
    expect(db.select().from(streamHeaders).all()).toEqual([]);
    expect(streamHeadersFor(db, bookId, 'http://nas.local:8080/dune.mp3', hostsOf)).toEqual({});
  });

  it("doesn't give one add-on's login to the book once another add-on plays it", () => {
    const db = createTestDb();
    const bookId = addStreamedBook(db, { addonUrl: LOCAL, meta, stream: stream(), now: 1, newId });
    // The same recording, now from another add-on without headers: the old ones go.
    const plain: Stream = { ...stream('http://evil.example/dune.mp3'), headers: undefined };
    addStreamedBook(db, { addonUrl: OTHER, meta, stream: plain, now: 2, newId });
    expect(streamHeadersFor(db, bookId, 'http://evil.example/dune.mp3', hostsOf)).toEqual({});
    expect(db.select().from(streamHeaders).all()).toEqual([]);
  });

  it('stays out of sync and exports, and goes with its book', () => {
    const db = createTestDb();
    const bookId = addStreamedBook(db, { addonUrl: LOCAL, meta, stream: stream(), now: 1, newId });
    expect(JSON.stringify(collectOps(db, -1))).not.toContain('very-secret');
    expect(JSON.stringify(exportLibrary(db, 2))).not.toContain('very-secret');
    removeStreamedBook(db, bookId, 3);
    expect(db.select().from(streamHeaders).all()).toEqual([]);
  });

  it('refuses a web add-on stream that asks for headers, and keeps an in-app one', async () => {
    const manifest: Manifest = {
      id: 'x',
      version: '1.0.0',
      protocol: 1,
      name: 'X',
      description: '',
      types: ['audiobook'],
      resources: ['stream'],
      catalogs: [],
    };
    const body = { streams: [stream(), { ...stream(), headers: undefined, sourceKey: 'plain' }] };
    const fetcher: Fetcher = async () => ({ ok: true, status: 200, json: async () => body });
    const web: InstalledAddon = { id: '1', url: WEB, manifest, builtin: false };
    const local: InstalledAddon = {
      id: '2',
      url: LOCAL,
      manifest: { ...manifest, sandbox: { hosts: ['nas.local:8080'] } },
      builtin: false,
    };
    const fromWeb = await fetchAddonStreams(fetcher, web, 'audiobook', 'home:dune');
    expect(fromWeb.map((f) => f.stream.sourceKey)).toEqual(['plain']);
    const fromLocal = await fetchAddonStreams(fetcher, local, 'audiobook', 'home:dune');
    expect(fromLocal.map((f) => f.stream.headers)).toEqual([{ Authorization: TOKEN }, undefined]);
  });
});
