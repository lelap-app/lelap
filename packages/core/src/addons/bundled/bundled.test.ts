import { createHash, webcrypto } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import {
  applySignin,
  LibraryResponse,
  LocateResponse,
  offersLibrary,
  offersSignin,
  readSettings,
  settingHosts,
  SigninResult,
  SigninStart,
} from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { hostAllowed } from '../local';
import { BUNDLED_FILES } from './generated';
import { bundledAddon, bundledAddons } from './index';

const dir = new URL('./', import.meta.url);

type Reply = { status: number; body: string; type?: string; date?: string };
type Init = { method?: string; headers?: Record<string, string>; body?: string };
type Handlers = {
  manifest: unknown;
  library: (args: unknown) => Promise<unknown>;
  place?: (args: unknown) => Promise<unknown>;
  signin?: (args: unknown) => Promise<unknown>;
  locate?: (args: unknown) => Promise<unknown>;
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
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'date' ? (reply.date ?? null) : (reply.type ?? 'text/html'),
          },
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

  it('declares valid library sources with a sandbox, and plex.tv as the only fixed host', () => {
    // The Open Library reading log (M61) is a scrobbler, not a library source.
    for (const addon of bundledAddons().filter(
      (a) => a.manifest.id !== 'app.lelap.openlibrary-log',
    )) {
      expect(offersLibrary(addon.manifest)).toBe(true);
      expect(addon.manifest.sandbox?.hosts).toEqual(
        addon.manifest.id === 'app.lelap.plex' ? ['plex.tv:443'] : [],
      );
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
  function navidrome(
    options: { openSubsonic?: boolean; password?: string; clockAheadMs?: number } = {},
  ) {
    const calls: Call[] = [];
    const salts = new Set<string>();
    const bookmarks = new Map<string, number>();
    const json = (body: string): Reply => ({
      status: 200,
      type: 'application/json',
      body,
      ...(options.clockAheadMs === undefined
        ? {}
        : { date: new Date(Date.now() + options.clockAheadMs).toUTCString() }),
    });
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

  it('tidies the book’s older bookmarks in a sandbox that never listed the library', async () => {
    const nd = navidrome();
    const stream = (id: string) =>
      `http://nas.local:4533/rest/stream?id=${id}&format=raw&v=1.16.1&c=lelap`;
    const book = [
      {
        path: 'Ada Writer/The Quiet Town/001 Chapter 1.mp3',
        url: stream('6OBZNgINrkxkmI2U4zOkfC'),
      },
      {
        path: 'Ada Writer/The Quiet Town/002 Chapter 2.mp3',
        url: stream('4u80kfxwui4N7DyyzPd2G1'),
      },
    ];
    await run(login, nd.server).place({
      file: book[0],
      files: book,
      positionMs: 700,
      at: 5,
      finished: false,
    });
    const deleted = nd.calls.filter((c) => c.method === 'deleteBookmark');
    expect(deleted.map((c) => c.params.get('id'))).toEqual(['4u80kfxwui4N7DyyzPd2G1']);
  });

  it('puts bookmark times on the phone’s clock when the server’s runs ahead', async () => {
    const hour = 60 * 60 * 1000;
    const result = await run(login, navidrome({ clockAheadMs: hour }).server).list();
    const at = result.files[1]?.place?.at ?? 0;
    // The Date header counts whole seconds.
    expect(Math.abs(at - (Date.parse('2026-11-18T01:39:08.863180346Z') - hour))).toBeLessThan(
      2_000,
    );
    const close = await run(login, navidrome({ clockAheadMs: 20_000 }).server).list();
    expect(close.files[1]?.place?.at).toBe(Date.parse('2026-11-18T01:39:08.863180346Z'));
  });
});

// Answers recorded from Emby Server 4.10.2 in Docker, with an “Audiobooks” library (two books
// made with `say`) and a “Music” library; the access token is replaced with `emby-test-token`.
const emby = (name: string): string =>
  readFileSync(new URL(`../../../test/fixtures/emby/${name}.json`, import.meta.url), 'utf8');

describe('Emby', () => {
  const manifest = bundledAddon('lelap-local://app.lelap.emby/manifest.json')?.manifest;
  const fields = manifest?.settings ?? [];
  const TOKEN = 'emby-test-token';
  const API_KEY = 'emby-api-key-0123456789';
  const USER = 'bcabd293d25e489684749058b00172c2';

  type Call = { method: string; path: string; url: string; headers: Record<string, string> };

  /** An Emby server from the recorded answers, checking the login on every call. */
  function server(options: { password?: string; nameOrderSkips?: string } = {}) {
    const calls: Call[] = [];
    const saved = new Map<string, unknown>();
    const json = (body: string): Reply => ({ status: 200, type: 'application/json', body });
    // A listing by name that lost an item between pages, with the count Emby gave.
    const skipping = (body: string): string => {
      const all = JSON.parse(body) as { Items: { Id: string }[]; TotalRecordCount: number };
      const Items = all.Items.filter((i) => i.Id !== options.nameOrderSkips);
      return JSON.stringify({ ...all, Items: [...Items, Items[0]] });
    };
    const answer = (url: string, headers: Record<string, string>, init: Init): Reply => {
      const address = new URL(url);
      const path = address.pathname.replace(/^\/emby/, '');
      const method = init.method ?? 'GET';
      calls.push({ method, path, url, headers });
      if (!address.pathname.startsWith('/emby/')) return { status: 404, body: '' };
      if (path === '/Users/AuthenticateByName' && method === 'POST') {
        const body = JSON.parse(init.body ?? '{}') as { Username?: string; Pw?: string };
        if (body.Username !== 'lelap' || body.Pw !== (options.password ?? 'test-pass')) {
          return { status: 401, body: 'Invalid username or password. Please try again.' };
        }
        return json(emby('AuthenticateByName'));
      }
      const token = headers['X-Emby-Token'];
      if (token !== TOKEN && token !== API_KEY) return { status: 401, body: '' };
      if (path === '/Users' && token === API_KEY) return json(emby('Users'));
      if (path === `/Users/${USER}/Views`) return json(emby('Views'));
      if (path === `/Users/${USER}/Items` && address.searchParams.get('ParentId') === '3') {
        const byName = address.searchParams.get('SortBy') === 'SortName';
        return json(byName && options.nameOrderSkips ? skipping(emby('Items-3')) : emby('Items-3'));
      }
      if (path === `/Users/${USER}/Items` && address.searchParams.has('Ids')) {
        return json(emby('Items-folders'));
      }
      const data = /^\/Users\/[^/]+\/Items\/([^/]+)\/UserData$/.exec(path);
      if (data && method === 'POST') {
        saved.set(data[1] ?? '', JSON.parse(init.body ?? '{}'));
        return { status: 204, body: '' };
      }
      return { status: 404, body: '' };
    };
    return { answer, calls, saved };
  }

  function run(settings: Record<string, string>, answer: ReturnType<typeof server>['answer']) {
    const read = readSettings(fields, settings);
    if ('error' in read) throw new Error(read.error);
    const loaded = load('emby.js', answer);
    loaded.hosts.push(...(manifest?.sandbox?.hosts ?? []), ...settingHosts(fields, read.settings));
    return {
      list: async () =>
        LibraryResponse.parse(await loaded.handlers.library({ settings: read.settings })),
      place: (place: unknown) => loaded.handlers.place?.({ settings: read.settings, place }),
    };
  }

  const login = {
    url: 'http://nas.local:8096/web/index.html',
    user: 'lelap',
    password: 'test-pass',
  };

  it('lists again in the order items were added when a page by name lost one', async () => {
    const skips = server({ nameOrderSkips: '10' });
    const result = await run(login, skips.answer).list();
    expect(result.files.map((f) => f.path)).toContain(
      'Frances Hodgson Burnett/The Secret Garden/002 Chapter 2.mp3',
    );
    const listings = skips.calls.filter((c) => new URL(c.url).searchParams.get('ParentId'));
    expect(listings.map((c) => new URL(c.url).searchParams.get('SortBy'))).toEqual([
      'SortName',
      'DateCreated,SortName',
    ]);
    // A complete listing is asked for once.
    const whole = server();
    await run(login, whole.answer).list();
    expect(whole.calls.filter((c) => new URL(c.url).searchParams.get('ParentId'))).toHaveLength(1);
  });

  it('lists audiobook libraries as books, with the token as a header and for the browser', async () => {
    const recorded = server();
    const result = await run(login, recorded.answer).list();
    expect(result.files.map((f) => f.path)).toEqual([
      'Kenneth Grahame/The Wind in the Willows/001 The Wind in the Willows.m4b',
      'Frances Hodgson Burnett/The Secret Garden/001 Chapter 1.mp3',
      'Frances Hodgson Burnett/The Secret Garden/002 Chapter 2.mp3',
      'Frances Hodgson Burnett/The Secret Garden/cover.jpg',
    ]);
    const [willows, first, second, cover] = result.files;
    expect(first).toMatchObject({
      url: 'http://nas.local:8096/emby/Audio/11/stream?static=true',
      downloadUrl: 'http://nas.local:8096/emby/Items/11/Download',
      durationMs: 2403,
      title: 'Chapter 1',
      album: 'The Secret Garden',
      albumArtist: 'Frances Hodgson Burnett',
      size: 9993,
    });
    expect(first?.place).toBeUndefined();
    // The place set on the server, with when it was set.
    expect(second?.place).toEqual({ positionMs: 1500, at: Date.parse('2026-11-18T02:30:00Z') });
    expect(cover?.url).toBe(
      'http://nas.local:8096/emby/Items/9/Images/Primary?maxHeight=1200&tag=4fb90696aeec375a5960aaa87f7cd55d_639305645713410640',
    );
    expect(willows?.place).toEqual({
      positionMs: 0,
      at: Date.parse('2026-11-17T21:00:00Z'),
      played: true,
    });
    expect(willows?.chapters).toEqual([
      { title: 'The River Bank', startMs: 0 },
      { title: 'The Open Road', startMs: 2500 },
    ]);

    expect(result.headers).toEqual({ 'X-Emby-Token': TOKEN });
    expect(result.webQuery).toEqual({ api_key: TOKEN });
    expect(result.query).toBeUndefined();
    const listed = JSON.stringify(result.files);
    for (const secret of [TOKEN, 'test-pass', 'api_key']) expect(listed).not.toContain(secret);
    // The password goes only in the sign-in's body; the token only as a header, to this server.
    for (const call of recorded.calls) {
      expect(call.url.startsWith('http://nas.local:8096/emby/')).toBe(true);
      expect(call.url).not.toContain('test-pass');
      expect(call.url).not.toContain(TOKEN);
    }
    expect(recorded.calls[0]?.headers['X-Emby-Token']).toBeUndefined();
    expect(recorded.calls[0]?.headers['X-Emby-Authorization']).toMatch(
      /^Emby UserId="", Client="Lelap", Device="Lelap", DeviceId="lelap-[0-9a-f]+", Version="1.0.0"$/,
    );
  });

  it('keeps one device for one server and user, so Emby gives the same token back', async () => {
    const a = server();
    const b = server();
    await run(login, a.answer).list();
    await run({ ...login, url: 'http://nas.local:8096/' }, b.answer).list();
    const device = (c: Call | undefined) => c?.headers['X-Emby-Authorization'];
    expect(device(a.calls[0])).toBe(device(b.calls[0]));
  });

  it('uses an API key with the username instead of a password', async () => {
    const recorded = server();
    const result = await run(
      { url: 'http://nas.local:8096', user: 'LELAP', apiKey: API_KEY },
      recorded.answer,
    ).list();
    expect(result.files).toHaveLength(4);
    expect(result.headers).toEqual({ 'X-Emby-Token': API_KEY });
    expect(recorded.calls.some((c) => c.path === '/Users/AuthenticateByName')).toBe(false);
  });

  it('takes the libraries named, and names those there are when one is not', async () => {
    const named = await run({ ...login, libraries: 'audiobooks' }, server().answer).list();
    expect(named.files).toHaveLength(4);
    await expect(run({ ...login, libraries: 'Books' }, server().answer).list()).rejects.toThrow(
      'The Emby server has no library called “Books” for this user. It has “Audiobooks”, “Music”.',
    );
  });

  it('says when the password is wrong, without the address in the message', async () => {
    const error = await run({ ...login, password: 'nope' }, server().answer)
      .list()
      .catch((e: unknown) => e);
    expect(String(error)).toContain('Emby refused the username or password');
    expect(String(error)).not.toContain('nas.local');
  });

  it('saves the place as the user’s data, and marks the item played at the end', async () => {
    const recorded = server();
    const source = run(login, recorded.answer);
    const result = await source.list();
    const [, first, second] = result.files;
    const file = (f: typeof first) => ({ path: f?.path ?? '', url: f?.url ?? '' });
    const book = [file(first), file(second)];
    const at = Date.parse('2026-11-18T04:00:00Z');
    await source.place({ file: book[0], files: book, positionMs: 1200, at, finished: false });
    expect(recorded.saved.get('11')).toEqual({
      Played: false,
      PlaybackPositionTicks: 12_000_000,
      LastPlayedDate: '2026-11-18T04:00:00.000Z',
    });
    await source.place({ file: book[1], files: book, positionMs: 5015, at, finished: true });
    expect(recorded.saved.get('10')).toMatchObject({ Played: true, PlaybackPositionTicks: 0 });
  });

  it('signs in again to save a place in a sandbox that never listed the library', async () => {
    const recorded = server();
    const file = {
      path: 'Frances Hodgson Burnett/The Secret Garden/001 Chapter 1.mp3',
      url: 'http://nas.local:8096/emby/Audio/11/stream?static=true',
    };
    await run(login, recorded.answer).place({
      file,
      files: [file],
      positionMs: 700,
      at: 5,
      finished: false,
    });
    expect(recorded.calls.map((c) => c.path)).toEqual([
      '/Users/AuthenticateByName',
      `/Users/${USER}/Items/11/UserData`,
    ]);
  });
});

// Plex answers, written by hand in the shapes plex.tv and Plex Media Server 1.41 give (no Plex
// account was used): a PIN, the account's resources with a phone, an owned server with local,
// remote and relayed connections and a friend's server, and a music library “Audiobooks”.
const plex = (name: string): string =>
  readFileSync(new URL(`../../../test/fixtures/plex/${name}.json`, import.meta.url), 'utf8');

describe('Plex', () => {
  const manifest = bundledAddon('lelap-local://app.lelap.plex/manifest.json')?.manifest;
  const fields = manifest?.settings ?? [];
  const ACCOUNT = 'plex-account-token';
  const SERVER = 'plex-server-token';
  const MACHINE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const HOME = 'https://192-168-1-20.0f1e2d3c4b5a69788796a5b4c3d2e1f0.plex.direct:32400';
  const AWAY = 'https://203-0-113-7.0f1e2d3c4b5a69788796a5b4c3d2e1f0.plex.direct:32400';

  type Call = { url: string; headers: Record<string, string>; method: string };

  /** plex.tv and the server from the hand-written answers; `home` false: away from home. */
  function world(
    options: {
      approved?: boolean;
      home?: boolean;
      machine?: string;
      plexTv?: boolean;
      pages?: number;
      /** Addresses where nothing answers any more. */
      gone?: string[];
    } = {},
  ) {
    const calls: Call[] = [];
    const saved: { path: string; params: URLSearchParams }[] = [];
    let approved = options.approved ?? true;
    const json = (body: string): Reply => ({ status: 200, type: 'application/json', body });
    const answer = (url: string, headers: Record<string, string>, init: Init): Reply => {
      const address = new URL(url);
      calls.push({ url, headers, method: init.method ?? 'GET' });
      if (headers['X-Plex-Product'] !== 'Lelap' || !headers['X-Plex-Client-Identifier']) {
        return { status: 400, body: '' };
      }
      if (address.host === 'plex.tv') {
        if (options.plexTv === false) throw new Error('offline');
        if (address.pathname === '/api/v2/pins' && init.method === 'POST') {
          return json(plex('pins'));
        }
        if (address.pathname === '/api/v2/pins/2034967251') {
          if (address.searchParams.get('code') !== 'K7QX') return { status: 404, body: '{}' };
          return json(plex(approved ? 'pins-done' : 'pins'));
        }
        if (address.pathname === '/api/v2/resources') {
          if (headers['X-Plex-Token'] !== ACCOUNT) return { status: 401, body: '' };
          return json(plex('resources'));
        }
        return { status: 404, body: '' };
      }
      if (address.origin === HOME && options.home === false) throw new Error('timed out');
      if (options.gone?.includes(address.origin)) throw new Error('timed out');
      if (address.pathname === '/identity') {
        if (headers['X-Plex-Token']) throw new Error('A token went to an unchecked address.');
        const body = JSON.parse(plex('identity')) as {
          MediaContainer: { machineIdentifier: string };
        };
        if (options.machine) body.MediaContainer.machineIdentifier = options.machine;
        return json(JSON.stringify(body));
      }
      const token = headers['X-Plex-Token'];
      if (token !== SERVER && !(options.plexTv === false && token === ACCOUNT)) {
        return { status: 401, body: '' };
      }
      if (address.pathname === '/library/sections') return json(plex('sections'));
      if (address.pathname === '/library/sections/2/all' && options.pages) {
        // A library of `pages` full pages, with the recorded tracks on the first one.
        const start = Number(address.searchParams.get('X-Plex-Container-Start'));
        const recorded = JSON.parse(plex('tracks-2')) as {
          MediaContainer: { Metadata: unknown[] };
        };
        const own = start === 0 ? recorded.MediaContainer.Metadata : [];
        const filler = Array.from({ length: 500 - own.length }, (_, i) => ({
          ratingKey: `f${start + i}`,
          parentRatingKey: `fp${start}`,
          title: 'Filler',
          Media: [{ Part: [{ key: `/library/parts/9${start + i}/1/file.mp3`, file: 'f.mp3' }] }],
        }));
        return json(
          JSON.stringify({
            MediaContainer: { totalSize: options.pages * 500, Metadata: [...own, ...filler] },
          }),
        );
      }
      if (address.pathname === '/library/sections/2/all') return json(plex('tracks-2'));
      if (address.pathname === '/:/progress' || address.pathname === '/:/scrobble') {
        saved.push({ path: address.pathname, params: address.searchParams });
        return { status: 200, body: '' };
      }
      return { status: 404, body: '' };
    };
    return {
      answer,
      calls,
      saved,
      approve: () => {
        approved = true;
      },
    };
  }

  function run(settings: Record<string, string>, answer: ReturnType<typeof world>['answer']) {
    const loaded = load('plex.js', answer);
    const values: Record<string, string> = { ...settings };
    // The sandbox's hosts follow the form, as the app's do.
    const hosts = () => {
      loaded.hosts.splice(0, loaded.hosts.length, ...(manifest?.sandbox?.hosts ?? []));
      loaded.hosts.push(...settingHosts(fields, values));
    };
    hosts();
    return {
      values,
      signin: async (id: 'start' | 'check', state?: string) => {
        hosts();
        return loaded.handlers.signin?.({ id, settings: values, signin: { state } });
      },
      list: async () => {
        const read = readSettings(fields, values);
        if ('error' in read) throw new Error(read.error);
        hosts();
        return LibraryResponse.parse(await loaded.handlers.library({ settings: read.settings }));
      },
      place: (place: unknown) => loaded.handlers.place?.({ settings: values, place }),
      locate: async (files: { path: string; url: string }[]) => {
        hosts();
        return LocateResponse.parse(
          await loaded.handlers.locate?.({ settings: values, locate: { files } }),
        );
      },
    };
  }

  /** Signs in as the app does: start, check, and put the result into the form. */
  async function signedIn(answer: ReturnType<typeof world>['answer']) {
    const source = run({}, answer);
    const start = SigninStart.parse(await source.signin('start'));
    const result = SigninResult.parse(await source.signin('check', start.state));
    Object.assign(source.values, applySignin(fields, source.values, result, { hosts: true }));
    return source;
  }

  it('signs in with a code entered at plex.tv/link, as the product Lelap', async () => {
    expect(manifest && offersSignin(manifest)).toBe(true);
    const tv = world({ approved: false });
    const source = run({}, tv.answer);
    const start = SigninStart.parse(await source.signin('start'));
    expect(start).toMatchObject({
      code: 'K7QX',
      url: 'https://plex.tv/link',
      expiresAt: Date.parse('2026-11-18T03:15:00Z'),
    });
    expect(SigninResult.parse(await source.signin('check', start.state))).toEqual({});
    tv.approve();
    const result = SigninResult.parse(await source.signin('check', start.state));
    const account = JSON.parse(result.settings?.account ?? '{}') as Record<string, string>;
    expect(account).toEqual({
      client: expect.any(String),
      token: ACCOUNT,
      machine: MACHINE,
      server: SERVER,
      owned: true,
    });
    // The owned server, at home over https and away, never through the relay.
    expect(result.settings).toMatchObject({ server: 'Shelf', url: HOME, remote: AWAY });
    // One client ID for the whole sign-in, and nothing asked but plex.tv.
    const clients = new Set(tv.calls.map((c) => c.headers['X-Plex-Client-Identifier']));
    expect([...clients]).toEqual([account.client]);
    for (const call of tv.calls) {
      expect(call.url.startsWith('https://plex.tv/')).toBe(true);
      expect(call.url).not.toContain(ACCOUNT);
    }
  });

  it('keeps the client ID when signing in again, and takes the server named', async () => {
    const first = await signedIn(world().answer);
    const client = (JSON.parse(first.values.account ?? '{}') as { client: string }).client;
    const tv = world();
    const again = run(
      { account: first.values.account ?? '', server: 'Friend’s server' },
      tv.answer,
    );
    const start = SigninStart.parse(await again.signin('start'));
    const result = SigninResult.parse(await again.signin('check', start.state));
    expect(tv.calls.every((c) => c.headers['X-Plex-Client-Identifier'] === client)).toBe(true);
    expect(result.settings?.remote).toBe(
      'https://192-0-2-44.ffeeddccbbaa99887766554433221100.plex.direct:32400',
    );
    expect(result.settings?.url).toBeUndefined();
  });

  it('lists the music library named like audiobooks, with the server’s token sealed apart', async () => {
    const tv = world();
    const source = await signedIn(tv.answer);
    tv.calls.length = 0;
    const result = await source.list();
    expect(result.files.map((f) => f.path)).toEqual([
      'Frances Hodgson Burnett/The Secret Garden/001 Chapter 1.mp3',
      'Frances Hodgson Burnett/The Secret Garden/002 Chapter 2.mp3',
      'Frances Hodgson Burnett/The Secret Garden/cover.jpg',
      'Kenneth Grahame/The Wind in the Willows/001 The Wind in the Willows.m4b',
    ]);
    const [first, second, cover, willows] = result.files;
    expect(first).toMatchObject({
      url: `${HOME}/library/parts/313/1763434800/file.mp3`,
      downloadUrl: `${HOME}/library/parts/313/1763434800/file.mp3?download=1`,
      size: 9993,
      place: { positionMs: 0, at: 1763434850000, played: true },
    });
    // The first file of each book is read by the app, for chapters and ISBN or ASIN tags.
    expect(first?.durationMs).toBeUndefined();
    expect(willows?.durationMs).toBeUndefined();
    expect(second).toMatchObject({
      durationMs: 5015,
      title: 'Chapter 2',
      album: 'The Secret Garden',
      albumArtist: 'Frances Hodgson Burnett',
      place: { positionMs: 1500, at: 1763434900000 },
    });
    expect(cover?.url).toBe(`${HOME}/library/metadata/111/thumb/1763434800`);

    // The server's own token, not the account's, as a header and for the browser.
    expect(result.headers).toEqual({ 'X-Plex-Token': SERVER });
    expect(result.webQuery).toEqual({ 'X-Plex-Token': SERVER });
    expect(JSON.stringify(result.files)).not.toContain('token');
    // The account's token goes to plex.tv only, the server's to the checked address only.
    for (const call of tv.calls) {
      const token = call.headers['X-Plex-Token'];
      if (call.url.startsWith('https://plex.tv/')) expect(token).toBe(ACCOUNT);
      else expect(call.url.startsWith(`${HOME}/`) && (token === SERVER || !token)).toBe(true);
      expect(call.url).not.toContain('Token');
    }
    const onServer = tv.calls.filter((c) => !c.url.startsWith('https://plex.tv/'));
    expect(onServer[0]?.url).toBe(`${HOME}/identity`);
  });

  it('uses the address away from home when the one at home does not answer', async () => {
    const tv = world({ home: false });
    const source = await signedIn(tv.answer);
    const result = await source.list();
    expect(result.files[0]?.url).toBe(`${AWAY}/library/parts/313/1763434800/file.mp3`);
    // Never the relay, which the app would not let it reach anyway.
    expect(tv.calls.every((c) => !c.url.includes('198-51-100-9'))).toBe(true);
  });

  it('sends no token to an address where another server answers', async () => {
    const tv = world({ machine: 'ffffffffffffffffffffffffffffffff' });
    const source = await signedIn(tv.answer);
    tv.calls.length = 0;
    await expect(source.list()).rejects.toThrow('Another Plex server answers');
    const tokens = tv.calls.filter(
      (c) => !c.url.startsWith('https://plex.tv/') && c.headers['X-Plex-Token'],
    );
    expect(tokens).toEqual([]);
  });

  it('lists at home with the server’s token from the sign-in when plex.tv can’t be reached', async () => {
    const source = await signedIn(world().answer);
    const offline = world({ plexTv: false });
    const result = await run(source.values, offline.answer).list();
    expect(result.headers).toEqual({ 'X-Plex-Token': SERVER });
    expect(result.files).toHaveLength(4);
    expect(
      offline.calls.some(
        (c) => c.headers['X-Plex-Token'] === ACCOUNT && c.url.includes('plex.direct'),
      ),
    ).toBe(false);
  });

  it('never sends the account’s token to a server someone else shares', async () => {
    const source = await signedIn(world().answer);
    const account = JSON.parse(source.values.account ?? '{}') as Record<string, unknown>;
    // A friend's server with no token of its own kept, and plex.tv out of reach.
    const shared = JSON.stringify({ ...account, owned: undefined, server: undefined });
    const offline = world({ plexTv: false });
    await expect(run({ ...source.values, account: shared }, offline.answer).list()).rejects.toThrow(
      'plex.tv did not answer.',
    );
    const onServer = offline.calls.filter((c) => !c.url.startsWith('https://plex.tv/'));
    expect(onServer.every((c) => c.headers['X-Plex-Token'] !== ACCOUNT)).toBe(true);
  });

  it('asks for a new sign-in when plex.tv refuses the token', async () => {
    const source = await signedIn(world().answer);
    const account = JSON.parse(source.values.account ?? '{}') as Record<string, unknown>;
    const revoked = JSON.stringify({ ...account, token: 'revoked' });
    await expect(
      run({ ...source.values, account: revoked }, world().answer).list(),
    ).rejects.toThrow('plex.tv refused the sign-in. Sign in again.');
  });

  it('takes the libraries named, and names the music libraries there are when one is not', async () => {
    const source = await signedIn(world().answer);
    source.values.libraries = 'audiobooks';
    expect((await source.list()).files).toHaveLength(4);
    source.values.libraries = 'Films';
    await expect(source.list()).rejects.toThrow(
      'The Plex server has no music library called “Films”. It has “Music”, “Audiobooks”.',
    );
  });

  it('needs a sign-in before anything is listed', async () => {
    await expect(run({}, world().answer).list()).rejects.toThrow('Plex account: sign in first.');
  });

  it('saves the place as the track’s view offset, and scrobbles it at the end', async () => {
    const tv = world();
    const source = await signedIn(tv.answer);
    const result = await source.list();
    const [first, second] = result.files;
    const file = (f: typeof first) => ({ path: f?.path ?? '', url: f?.url ?? '' });
    const book = [file(first), file(second)];
    tv.calls.length = 0;
    await source.place({ file: book[0], files: book, positionMs: 1200, at: 5, finished: false });
    await source.place({ file: book[1], files: book, positionMs: 5015, at: 9, finished: true });
    // The server found by the listing is used again: no plex.tv, no identity check.
    expect(tv.calls.map((c) => new URL(c.url).pathname)).toEqual(['/:/progress', '/:/scrobble']);
    expect(tv.saved.map((s) => [s.path, Object.fromEntries(s.params)])).toEqual([
      [
        '/:/progress',
        { key: '113', identifier: 'com.plexapp.plugins.library', time: '1200', state: 'stopped' },
      ],
      ['/:/scrobble', { key: '112', identifier: 'com.plexapp.plugins.library' }],
    ]);
  });

  it('lists again to save a place in a sandbox that never listed the library', async () => {
    const source = await signedIn(world().answer);
    const tv = world();
    const file = {
      path: 'Frances Hodgson Burnett/The Secret Garden/002 Chapter 2.mp3',
      url: `${HOME}/library/parts/312/1763434800/file.mp3`,
    };
    await run(source.values, tv.answer).place({
      file,
      files: [file],
      positionMs: 2000,
      at: 5,
      finished: false,
    });
    expect(tv.saved.map((s) => s.params.get('key'))).toEqual(['112']);
  });

  it('stops looking at the page that has the track, so a large library saves in time', async () => {
    const source = await signedIn(world().answer);
    const big = world({ pages: 3 });
    const file = {
      path: 'Frances Hodgson Burnett/The Secret Garden/002 Chapter 2.mp3',
      url: `${HOME}/library/parts/312/1763434800/file.mp3`,
    };
    await run(source.values, big.answer).place({
      file,
      files: [file],
      positionMs: 2000,
      at: 5,
      finished: false,
    });
    expect(big.saved.map((s) => s.params.get('key'))).toEqual(['112']);
    expect(big.calls.filter((c) => c.url.includes('/library/sections/2/all'))).toHaveLength(1);
  });

  it('hands back the addresses plex.tv names when the form’s no longer answer', async () => {
    const OLD_HOME = 'https://192-168-1-5.0f1e2d3c4b5a69788796a5b4c3d2e1f0.plex.direct:32400';
    const OLD_AWAY = 'https://203-0-113-1.0f1e2d3c4b5a69788796a5b4c3d2e1f0.plex.direct:32400';
    const signed = await signedIn(world().answer);
    const tv = world({ gone: [OLD_HOME, OLD_AWAY] });
    const source = run({ ...signed.values, url: OLD_HOME, remote: OLD_AWAY }, tv.answer);
    const first = await source.list();
    expect(first).toEqual({ files: [], settings: { url: HOME, remote: AWAY } });
    // Nothing reached the new addresses before the app let it.
    expect(tv.calls.some((c) => c.url.startsWith(HOME) || c.url.startsWith(AWAY))).toBe(false);
    // The app saves them as it does a sign-in's, then lists again.
    Object.assign(source.values, applySignin(fields, source.values, first, { hosts: true }));
    const again = await source.list();
    expect(again.files).toHaveLength(4);
    expect(again.settings).toBeUndefined();
    expect(again.files[0]?.url.startsWith(`${HOME}/`)).toBe(true);
  });

  it('still fails when the form’s addresses are the ones plex.tv names', async () => {
    const source = await signedIn(world().answer);
    const down = world({ gone: [HOME, AWAY] });
    await expect(run(source.values, down.answer).list()).rejects.toThrow('timed out');
  });

  it('moves a book’s files to the address that answers before it streams', async () => {
    const source = await signedIn(world().answer);
    const files = [
      { path: 'A/B/001.mp3', url: `${HOME}/library/parts/313/1763434800/file.mp3` },
      { path: 'A/B/cover.jpg', url: `${HOME}/library/metadata/111/thumb/1` },
    ];
    const away = world({ home: false });
    const located = await run(source.values, away.answer).locate(files);
    expect(located.files).toEqual([
      { path: 'A/B/001.mp3', url: `${AWAY}/library/parts/313/1763434800/file.mp3` },
      { path: 'A/B/cover.jpg', url: `${AWAY}/library/metadata/111/thumb/1` },
    ]);
    // Only the identity, without a token, and never plex.tv.
    expect(away.calls.every((c) => new URL(c.url).pathname === '/identity')).toBe(true);
    expect(away.calls.every((c) => !c.headers['X-Plex-Token'])).toBe(true);

    const home = world();
    const there = await run(source.values, home.answer).locate(files);
    expect(there.files[0]?.url.startsWith(`${HOME}/`)).toBe(true);
  });

  it('locates nothing where another server answers, and fails where none does', async () => {
    const source = await signedIn(world().answer);
    const file = { path: 'A/B/001.mp3', url: `${HOME}/library/parts/313/1763434800/file.mp3` };
    const other = world({ machine: 'ffffffffffffffffffffffffffffffff' });
    expect(await run(source.values, other.answer).locate([file])).toEqual({ files: [] });
    const none = world({ gone: [HOME, AWAY] });
    await expect(run(source.values, none.answer).locate([file])).rejects.toThrow('timed out');
  });

  it('saves a place through the address away when the book was listed at home', async () => {
    const source = await signedIn(world().answer);
    const away = world({ home: false });
    const file = {
      path: 'Frances Hodgson Burnett/The Secret Garden/002 Chapter 2.mp3',
      url: `${HOME}/library/parts/312/1763434800/file.mp3`,
    };
    await run(source.values, away.answer).place({
      file,
      files: [file],
      positionMs: 2000,
      at: 5,
      finished: false,
    });
    expect(away.saved.map((s) => s.params.get('key'))).toEqual(['112']);
  });
});
