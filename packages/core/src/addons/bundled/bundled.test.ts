import { createHash, webcrypto } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { LibraryResponse, offersLibrary, readSettings, settingHosts } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { hostAllowed } from '../local';
import { BUNDLED_FILES } from './generated';
import { bundledAddon, bundledAddons } from './index';

const dir = new URL('./', import.meta.url);

type Reply = { status: number; body: string; type?: string };
type Init = { method?: string; headers?: Record<string, string>; body?: string };
type Handlers = {
  manifest: unknown;
  library: (args: unknown) => Promise<unknown>;
  place?: (args: unknown) => Promise<unknown>;
};

/**
 * Runs a bundled add-on file the way the sandbox does: `addon({...})` hands over its handlers and
 * `lelap.fetch` is the only way out, here to a fake server that also checks the host allowlist.
 */
function load(
  file: string,
  server: (url: string, headers: Record<string, string>, init: Init) => Reply,
) {
  let handlers: Handlers | null = null;
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const hosts: string[] = [];
  runInNewContext(readFileSync(new URL(file, dir), 'utf8'), {
    addon: (definition: Handlers) => {
      handlers = definition;
    },
    lelap: {
      fetch: async (url: string, init?: Init) => {
        if (!hostAllowed(url, hosts)) throw new Error(`Not allowed: ${url}`);
        const headers = init?.headers ?? {};
        asked.push({ url, headers });
        const reply = server(url, headers, init ?? {});
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
    crypto: webcrypto,
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

// Answers recorded from Navidrome 0.64 with two libraries, “Music Library” and “Audiobooks”.
const recorded = (name: string): string =>
  readFileSync(new URL(`../../../test/fixtures/subsonic/${name}.json`, import.meta.url), 'utf8');
const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');

describe('Subsonic', () => {
  const manifest = bundledAddon('lelap-local://app.lelap.subsonic/manifest.json')?.manifest;
  const fields = manifest?.settings ?? [];
  const PASSWORD = 'pässwörd with a long tail to fill more than one MD5 block of sixty-four';
  const TOWN = '3AZzjKPpcyIel8Cr3m8u2R';

  type Call = { method: string; params: URLSearchParams; post: boolean; url: string };

  /** A Subsonic server from the recorded answers, checking every token it gets. */
  function navidrome(options: { openSubsonic?: boolean; password?: string } = {}) {
    const calls: Call[] = [];
    const salts = new Set<string>();
    const bookmarks = new Map<string, number>();
    const json = (body: string): Reply => ({ status: 200, type: 'application/json', body });
    const server = (url: string, _headers: Record<string, string>, init: Init): Reply => {
      const address = new URL(url);
      const method = address.pathname.replace(/^.*\/rest\//, '');
      const post = init.method === 'POST';
      const params = post ? new URLSearchParams(init.body ?? '') : address.searchParams;
      calls.push({ method, params, post, url });
      if (method === 'getOpenSubsonicExtensions') {
        return options.openSubsonic === false
          ? { status: 404, body: 'Not found' }
          : json(recorded('getOpenSubsonicExtensions'));
      }
      if (params.has('p')) throw new Error('The password itself was sent.');
      const salt = params.get('s') ?? '';
      if (salts.has(salt)) throw new Error('A salt was used twice.');
      salts.add(salt);
      if (
        params.get('u') !== 'lelap' ||
        params.get('t') !== md5((options.password ?? PASSWORD) + salt)
      ) {
        return json(recorded('ping-wrong-password'));
      }
      const folder = params.get('musicFolderId');
      switch (method) {
        case 'ping':
          return json(recorded('ping'));
        case 'getMusicFolders':
          return json(recorded('getMusicFolders'));
        case 'getSongsByGenre':
          return json(
            recorded(
              folder === '2' ? 'getSongsByGenre-Audiobook-folder2' : 'getSongsByGenre-Audiobook',
            ),
          );
        case 'getAlbumList2':
          return json(recorded('getAlbumList2-alphabeticalByName-folder2'));
        case 'getAlbum':
          return json(recorded(`getAlbum-${params.get('id')}`));
        case 'getBookmarks':
          return json(recorded('getBookmarks'));
        case 'createBookmark':
          bookmarks.set(params.get('id') ?? '', Number(params.get('position')));
          return json(recorded('ping'));
        case 'deleteBookmark':
          bookmarks.delete(params.get('id') ?? '');
          return json(recorded('ping'));
        default:
          return { status: 404, body: '' };
      }
    };
    return { server, calls, bookmarks };
  }

  function run(settings: Record<string, string>, server: ReturnType<typeof navidrome>['server']) {
    const read = readSettings(fields, settings);
    if ('error' in read) throw new Error(read.error);
    const loaded = load('subsonic.js', server);
    loaded.hosts.push(...(manifest?.sandbox?.hosts ?? []), ...settingHosts(fields, read.settings));
    return {
      list: async () =>
        LibraryResponse.parse(await loaded.handlers.library({ settings: read.settings })),
      place: (place: unknown) => loaded.handlers.place?.({ settings: read.settings, place }),
    };
  }

  const login = { url: 'http://nas.local:4533', user: 'lelap', password: PASSWORD };

  it('lists albums with the genre Audiobook as books, with the token sealed apart', async () => {
    const nd = navidrome();
    const result = await run(login, nd.server).list();
    expect(result.files.map((f) => f.path)).toEqual([
      'Ada Writer/The Quiet Town/001 Chapter 1.mp3',
      'Ada Writer/The Quiet Town/002 Chapter 2.mp3',
      'Ada Writer/The Quiet Town/cover.jpg',
      'Frances Hodgson Burnett/The Secret Garden/001 The Secret Garden.m4b',
    ]);
    const [first, second, cover, garden] = result.files;
    expect(first?.url).toBe(
      'http://nas.local:4533/rest/stream?id=6OBZNgINrkxkmI2U4zOkfC&format=raw&v=1.16.1&c=lelap',
    );
    expect(first?.downloadUrl).toBe(
      'http://nas.local:4533/rest/download?id=6OBZNgINrkxkmI2U4zOkfC&v=1.16.1&c=lelap',
    );
    // The first file of each book is read by the app, for chapters and ISBN or ASIN tags.
    expect(first?.durationMs).toBeUndefined();
    expect(garden?.durationMs).toBeUndefined();
    expect(second).toMatchObject({
      durationMs: 3000,
      title: 'Chapter 2',
      album: 'The Quiet Town',
      albumArtist: 'Ada Writer',
      size: 24468,
      place: { positionMs: 1500, at: Date.parse('2026-11-18T01:39:08.863180346Z') },
    });
    expect(cover?.url).toContain('/rest/getCoverArt?id=al-3AZzjKPpcyIel8Cr3m8u2R_');

    // The login travels as a token made with a salt of its own, never the password.
    const query = result.query ?? {};
    expect(Object.keys(query).sort()).toEqual(['s', 't', 'u']);
    expect(query.t).toBe(md5(PASSWORD + query.s));
    const listed = JSON.stringify(result.files);
    for (const secret of [PASSWORD, query.t ?? '', `s=${query.s}`]) {
      expect(listed).not.toContain(secret);
    }
    // Navidrome takes form posts, so no API call has the token in its address.
    const api = nd.calls.filter((c) => c.method !== 'getOpenSubsonicExtensions');
    expect(api.map((c) => c.method)).toEqual(['ping', 'getSongsByGenre', 'getBookmarks']);
    expect(api.every((c) => c.post && !c.url.includes('?'))).toBe(true);
  });

  it('takes the albums of a chosen music folder, by name', async () => {
    const nd = navidrome();
    const result = await run({ ...login, folder: 'audiobooks' }, nd.server).list();
    expect(result.files.map((f) => f.path)).toEqual([
      'Ada Writer/The Quiet Town/001 Chapter 1.mp3',
      'Ada Writer/The Quiet Town/002 Chapter 2.mp3',
      'Ada Writer/The Quiet Town/cover.jpg',
    ]);
    const list = nd.calls.find((c) => c.method === 'getAlbumList2');
    expect(list?.params.get('musicFolderId')).toBe('2');
    expect(nd.calls.find((c) => c.method === 'getAlbum')?.params.get('id')).toBe(TOWN);

    const both = navidrome();
    await run({ ...login, folder: 'Audiobooks', genre: 'Audiobook' }, both.server).list();
    const byGenre = both.calls.find((c) => c.method === 'getSongsByGenre');
    expect(byGenre?.params.get('musicFolderId')).toBe('2');
  });

  it('names the music folders there are when the one asked for is not', async () => {
    const nd = navidrome();
    await expect(run({ ...login, folder: 'Books' }, nd.server).list()).rejects.toThrow(
      'The server has no music folder called “Books”. It has “Music Library”, “Audiobooks”.',
    );
  });

  it('says when the password is wrong, without the address in the message', async () => {
    const nd = navidrome({ password: 'something else' });
    const error = await run(login, nd.server)
      .list()
      .catch((e: unknown) => e);
    expect(String(error)).toContain('The server refused the username or password.');
    expect(String(error)).not.toContain('nas.local');
  });

  it('uses plain requests on a server without OpenSubsonic, still with a token', async () => {
    const nd = navidrome({ openSubsonic: false });
    const result = await run(login, nd.server).list();
    expect(result.files).toHaveLength(4);
    const api = nd.calls.filter((c) => c.method !== 'getOpenSubsonicExtensions');
    expect(api.every((c) => !c.post && c.params.has('t') && c.params.has('s'))).toBe(true);
    expect(nd.calls.every((c) => !c.url.includes(encodeURIComponent(PASSWORD)))).toBe(true);
  });

  it('saves the place as a bookmark and clears the book’s older ones', async () => {
    const nd = navidrome();
    const source = run(login, nd.server);
    const result = await source.list();
    const [first, second] = result.files;
    const file = (f: typeof first) => ({ path: f?.path ?? '', url: f?.url ?? '' });
    const book = [file(first), file(second)];
    // The recorded bookmark is on Chapter 2; the listener went back to Chapter 1.
    await source.place({ file: book[0], files: book, positionMs: 1200, at: 5, finished: false });
    expect([...nd.bookmarks]).toEqual([['6OBZNgINrkxkmI2U4zOkfC', 1200]]);
    const deleted = nd.calls.filter((c) => c.method === 'deleteBookmark');
    expect(deleted.map((c) => c.params.get('id'))).toEqual(['4u80kfxwui4N7DyyzPd2G1']);

    await source.place({ file: book[1], files: book, positionMs: 3000, at: 9, finished: true });
    expect(nd.bookmarks.size).toBe(0);
  });

  it('saves a place with a form post in a sandbox that never listed the library', async () => {
    const nd = navidrome();
    const file = {
      path: 'Ada Writer/The Quiet Town/001 Chapter 1.mp3',
      url: 'http://nas.local:4533/rest/stream?id=6OBZNgINrkxkmI2U4zOkfC&format=raw&v=1.16.1&c=lelap',
    };
    await run(login, nd.server).place({
      file,
      files: [file],
      positionMs: 700,
      at: 5,
      finished: false,
    });
    const saved = nd.calls.find((c) => c.method === 'createBookmark');
    expect(saved?.post).toBe(true);
    expect(saved?.url).not.toContain('?');
    expect([...nd.bookmarks]).toEqual([['6OBZNgINrkxkmI2U4zOkfC', 700]]);
  });
});
