import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { LibraryResponse, offersLibrary, readSettings, settingHosts } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { hostAllowed } from '../local';
import { BUNDLED_FILES } from './generated';
import { bundledAddon, bundledAddons } from './index';

const dir = new URL('./', import.meta.url);

type Reply = { status: number; body: string; type?: string };
type Handlers = { manifest: unknown; library: (args: unknown) => Promise<unknown> };

/**
 * Runs a bundled add-on file the way the sandbox does: `addon({...})` hands over its handlers and
 * `lelap.fetch` is the only way out, here to a fake server that also checks the host allowlist.
 */
function load(file: string, server: (url: string, headers: Record<string, string>) => Reply) {
  let handlers: Handlers | null = null;
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const hosts: string[] = [];
  runInNewContext(readFileSync(new URL(file, dir), 'utf8'), {
    addon: (definition: Handlers) => {
      handlers = definition;
    },
    lelap: {
      fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
        if (!hostAllowed(url, hosts)) throw new Error(`Not allowed: ${url}`);
        const headers = init?.headers ?? {};
        asked.push({ url, headers });
        const reply = server(url, headers);
        return {
          ok: reply.status >= 200 && reply.status < 300,
          status: reply.status,
          headers: { get: () => reply.type ?? 'text/html' },
          text: async () => reply.body,
        };
      },
    },
    URL,
    TextEncoder,
    btoa,
  });
  if (!handlers) throw new Error(`${file} never called addon()`);
  return { handlers: handlers as Handlers, asked, hosts };
}

const page = (...hrefs: string[]) =>
  `<html><body><h1>Index</h1>${hrefs.map((h) => `<a href="${h}">${h}</a>`).join('\n')}</body></html>`;

describe('bundled add-ons', () => {
  it('ships each add-on file as it is in the repository', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
    expect(BUNDLED_FILES.map((b) => b.file).sort()).toEqual(files.sort());
    for (const entry of BUNDLED_FILES) {
      const code = readFileSync(new URL(entry.file, dir), 'utf8');
      // Out of date: run `pnpm --filter @lelap/core bundle-addons`.
      expect(entry.code, entry.file).toBe(code);
      expect(entry.sha256).toBe(createHash('sha256').update(code).digest('hex'));
    }
  });

  it('declares valid library sources with a sandbox and no fixed hosts', () => {
    for (const addon of bundledAddons()) {
      expect(offersLibrary(addon.manifest)).toBe(true);
      expect(addon.url).toBe(`lelap-local://${addon.manifest.id}/manifest.json`);
      expect(bundledAddon(addon.url)).toBe(addon);
    }
    expect(bundledAddon('lelap-local://org.example.unknown/manifest.json')).toBeNull();
  });
});

describe('HTTP folder', () => {
  const manifest = bundledAddon('lelap-local://app.lelap.http-folder/manifest.json')?.manifest;
  const fields = manifest?.settings ?? [];

  function run(
    settings: Record<string, string>,
    server: (url: string, headers: Record<string, string>) => Reply,
  ) {
    const read = readSettings(fields, settings);
    if ('error' in read) throw new Error(read.error);
    const loaded = load('http-folder.js', server);
    loaded.hosts.push(...(manifest?.sandbox?.hosts ?? []), ...settingHosts(fields, read.settings));
    return {
      ...loaded,
      list: async () =>
        LibraryResponse.parse(await loaded.handlers.library({ settings: read.settings })),
    };
  }

  it('walks an HTML listing into books, leaving out links that lead elsewhere', async () => {
    const pages: Record<string, string> = {
      'http://nas.local:8080/books/': page(
        '../',
        '?C=N;O=D',
        'Frank%20Herbert/',
        'http://evil.example/steal/',
        '/elsewhere/',
        'notes.txt',
      ),
      'http://nas.local:8080/books/Frank%20Herbert/': page('../', 'Dune/', 'Dune%20Messiah.m4b'),
      'http://nas.local:8080/books/Frank%20Herbert/Dune/': page(
        '01%20Prologue.mp3',
        '02.mp3',
        'cover.jpg',
        '#top',
      ),
    };
    const { list, asked } = run({ url: 'http://nas.local:8080/books' }, (url) =>
      pages[url] ? { status: 200, body: pages[url] } : { status: 404, body: '' },
    );
    const result = await list();
    expect(result.files.map((f) => f.path)).toEqual([
      'Frank Herbert/Dune Messiah.m4b',
      'Frank Herbert/Dune/01 Prologue.mp3',
      'Frank Herbert/Dune/02.mp3',
      'Frank Herbert/Dune/cover.jpg',
    ]);
    expect(result.headers).toBeUndefined();
    expect(asked.every((a) => a.url.startsWith('http://nas.local:8080/books/'))).toBe(true);
    expect(asked.every((a) => Object.keys(a.headers).length === 0)).toBe(true);
  });

  it('sends the login as HTTP Basic and asks the app to send it with the audio', async () => {
    const { list, asked } = run(
      { url: 'https://dav.example/audio/', user: 'kåre', password: 'pass:word' },
      (_url, headers) =>
        headers.Authorization ? { status: 200, body: page('a.mp3') } : { status: 401, body: '' },
    );
    const result = await list();
    const expected = `Basic ${Buffer.from('kåre:pass:word', 'utf8').toString('base64')}`;
    expect(result.headers).toEqual({ Authorization: expected });
    expect(asked[0]?.headers).toEqual({ Authorization: expected });
    expect(result.files.map((f) => f.url)).toEqual(['https://dav.example/audio/a.mp3']);
  });

  it('reads nginx’s JSON listing with sizes and times', async () => {
    const json = (entries: unknown[]) => ({
      status: 200,
      type: 'application/json',
      body: JSON.stringify(entries),
    });
    const { list } = run({ url: 'http://nas.local/b/' }, (url) =>
      url === 'http://nas.local/b/'
        ? json([
            { name: 'Book', type: 'directory', mtime: 'Mon, 01 Jan 2024 00:00:00 GMT' },
            { name: '../x', type: 'directory' },
          ])
        : json([
            {
              name: 'part 1.mp3',
              type: 'file',
              size: 1234,
              mtime: 'Mon, 01 Jan 2024 00:00:00 GMT',
            },
          ]),
    );
    const result = await list();
    expect(result.files).toEqual([
      {
        path: 'Book/part 1.mp3',
        url: 'http://nas.local/b/Book/part%201.mp3',
        size: 1234,
        modifiedAt: Date.UTC(2024, 0, 1),
      },
    ]);
  });

  it('fails the whole listing when a folder refuses, so no book is marked missing', async () => {
    const { list } = run({ url: 'http://nas.local/b/' }, (url) =>
      url === 'http://nas.local/b/'
        ? { status: 200, body: page('Book/') }
        : { status: 403, body: '' },
    );
    await expect(list()).rejects.toThrow('HTTP 403');
  });
});
