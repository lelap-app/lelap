import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { LibraryResponse, type PlaceReport, readSettings, settingHosts } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { hostAllowed } from '../local';
import { bundledAddon } from './index';

// The OPDS add-on (M128) against fixture feeds: Calibre's OPDS 1 as its `opds.py` writes it, an
// OPDS 2 catalog with a Readium audiobook manifest, logins and a catalog past the limits.

const dir = new URL('./', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(`fixtures/opds/${name}`, dir), 'utf8');

type Reply = { status: number; body: string; type?: string; headers?: Record<string, string> };
type Asked = { url: string; headers: Record<string, string>; method: string; body?: string };
type Server = (url: string, headers: Record<string, string>, asked: Asked) => Reply;

const ATOM = 'application/atom+xml; charset=UTF-8';
const OPDS2 = 'application/opds+json';
const atom = (body: string): Reply => ({ status: 200, body, type: ATOM });
const json = (body: string, type = OPDS2): Reply => ({ status: 200, body, type });
const missing: Reply = { status: 404, body: 'Not found', type: 'text/plain' };

const manifest = bundledAddon('lelap-local://app.lelap.opds/manifest.json')?.manifest;
const fields = manifest?.settings ?? [];

/** Runs opds.js as the sandbox does, and lists the library page by page as the app does. */
function run(settings: Record<string, string>, server: Server) {
  const read = readSettings(fields, settings);
  if ('error' in read) throw new Error(read.error);
  const hosts = [...(manifest?.sandbox?.hosts ?? []), ...settingHosts(fields, read.settings)];
  const asked: Asked[] = [];
  let library: ((args: unknown) => Promise<unknown>) | null = null;
  let place: ((args: unknown) => Promise<unknown>) | null = null;
  runInNewContext(readFileSync(new URL('opds.js', dir), 'utf8'), {
    addon: (definition: { library: typeof library; place: typeof place }) => {
      library = definition.library;
      place = definition.place;
    },
    lelap: {
      fetch: async (
        url: string,
        init?: { headers?: Record<string, string>; method?: string; body?: string },
      ) => {
        if (!hostAllowed(url, hosts)) throw new Error(`Not allowed: ${url}`);
        const headers = init?.headers ?? {};
        const request: Asked = {
          url,
          headers,
          method: init?.method ?? 'GET',
          ...(init?.body === undefined ? {} : { body: init.body }),
        };
        asked.push(request);
        const reply = server(url, headers, request);
        return {
          ok: reply.status >= 200 && reply.status < 300,
          status: reply.status,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'content-type'
                ? (reply.type ?? null)
                : (reply.headers?.[name.toLowerCase()] ?? null),
          },
          text: async () => reply.body,
        };
      },
    },
    URL,
    TextEncoder,
    btoa,
    crypto: globalThis.crypto,
  });
  const report = (args: { settings?: Record<string, string>; place: PlaceReport }) => {
    if (!place) throw new Error('opds.js has no place handler');
    return place({ settings: read.settings, ...args });
  };
  const call = async (cursor?: string) => {
    if (!library) throw new Error('opds.js never called addon()');
    return LibraryResponse.parse(
      await library({ settings: read.settings, library: cursor === undefined ? {} : { cursor } }),
    );
  };
  const list = async () => {
    const first = await call();
    const files = [...first.files];
    let calls = 1;
    for (let next = first.next; next; calls++) {
      const page = await call(next);
      files.push(...page.files);
      next = page.next;
    }
    return { ...first, files, calls };
  };
  return { call, list, asked, report };
}

function calibre(origin: string): Server {
  return (url) => {
    const { pathname, search } = new URL(url);
    if (!url.startsWith(origin)) return missing;
    if (pathname === '/opds') return atom(fixture('calibre-root.xml'));
    if (pathname === '/opds/navcatalog/4f7469746c65') {
      return atom(
        fixture(search.includes('offset=2') ? 'calibre-title-2.xml' : 'calibre-title-0.xml'),
      );
    }
    return missing;
  };
}

describe('OPDS', () => {
  it('is a library source whose only host is the address the listener types', () => {
    expect(manifest?.resources).toEqual(['library', 'place']);
    expect(manifest?.sandbox?.hosts).toEqual([]);
    expect(fields.find((f) => f.key === 'url')).toMatchObject({ type: 'url', host: true });
  });

  it('lists only the audiobooks of a Calibre library, with covers, from its By Title feed', async () => {
    const { list, asked } = run(
      { url: 'http://192.168.1.20:8080/opds' },
      calibre('http://192.168.1.20:8080'),
    );
    const result = await list();
    expect(result.files).toEqual([
      {
        path: 'Arthur Conan Doyle/The Hound of the Baskervilles/The Hound of the Baskervilles.m4b',
        url: 'http://192.168.1.20:8080/get/m4b/2/Calibre_Library',
        size: 183402311,
        modifiedAt: Date.UTC(2026, 9, 2, 9, 30),
        title: 'The Hound of the Baskervilles',
        album: 'The Hound of the Baskervilles',
        artist: 'Arthur Conan Doyle',
        albumArtist: 'Arthur Conan Doyle',
        ids: ['isbn:9780140437867'],
        series: [{ name: 'Sherlock Holmes', position: '5' }],
      },
      {
        path: 'Arthur Conan Doyle/The Hound of the Baskervilles/cover.jpg',
        url: 'http://192.168.1.20:8080/get/cover/2/Calibre_Library',
        modifiedAt: expect.any(Number),
      },
      {
        path: 'Robert Louis Stevenson/Treasure Island/Treasure Island.mp3',
        url: 'http://192.168.1.20:8080/get/mp3/3/Calibre_Library',
        size: 98402311,
        modifiedAt: Date.UTC(2026, 9, 3, 9, 30),
        title: 'Treasure Island',
        album: 'Treasure Island',
        artist: 'Robert Louis Stevenson',
        albumArtist: 'Robert Louis Stevenson',
      },
      {
        path: 'Robert Louis Stevenson/Treasure Island/cover.jpg',
        url: 'http://192.168.1.20:8080/get/cover/3/Calibre_Library',
        modifiedAt: expect.any(Number),
      },
    ]);
    expect(result.headers).toBeUndefined();
    // By Newest and By Authors hold the same books again, so they are never read; nor is
    // anything but the feeds, so no ebook or cover is downloaded.
    const read = asked.map((a) => new URL(a.url));
    expect(read.every((u) => u.pathname === '/opds' || u.pathname.endsWith('/4f7469746c65'))).toBe(
      true,
    );
    expect(asked[0]?.headers.Accept).toContain('application/opds+json');
  });

  it('reads an OPDS 2 catalog, playing a Readium audiobook as one book with its parts in order', async () => {
    const origin = 'https://books.example.org';
    const { list, asked } = run({ url: `${origin}/catalog/root.json` }, (url) => {
      const { pathname, search } = new URL(url);
      if (!url.startsWith(origin)) return missing;
      if (pathname === '/catalog/root.json') return json(fixture('opds2-root.json'));
      if (pathname === '/catalog/audiobooks.json') {
        return json(
          fixture(search === '?page=2' ? 'opds2-audiobooks-2.json' : 'opds2-audiobooks-1.json'),
        );
      }
      if (pathname === '/audiobooks/pride/manifest.json') {
        return json(fixture('readium-pride.json'), 'application/audiobook+json');
      }
      return missing;
    });
    const result = await list();
    const pride = 'Jane Austen/Pride and Prejudice';
    expect(result.files.map((f) => [f.path, f.url, f.durationMs])).toEqual([
      [
        `${pride}/001 Chapters 1 to 5.mp3`,
        `${origin}/audiobooks/pride/01-chapters-1-5.mp3`,
        undefined,
      ],
      [
        `${pride}/002 Chapters 6 to 10.mp3`,
        `${origin}/audiobooks/pride/02-chapters-6-10.mp3`,
        1200000,
      ],
      [`${pride}/003 Chapters 11 to 15.mp3`, 'https://cdn.example.org/pride/03.mp3', 1199500],
      [`${pride}/cover.png`, `${origin}/covers/pride.png`, undefined],
      [
        'H. G. Wells/The Time Machine/The Time Machine.mp3',
        `${origin}/audio/time-machine.mp3`,
        undefined,
      ],
      [
        'H. G. Wells/The Time Machine/cover.jpg',
        'https://images.example.org/time-machine.jpg',
        undefined,
      ],
    ]);
    expect(result.files[0]).toMatchObject({
      title: 'Chapters 1 to 5',
      album: 'Pride and Prejudice',
      albumArtist: 'Jane Austen',
      ids: ['isbn:9780141439518'],
      modifiedAt: Date.UTC(2026, 8, 1, 12),
    });
    // Borrow, buy and DRM links are never followed, nor the search template.
    expect(asked.some((a) => /loans|shop|drm|search/.test(a.url))).toBe(false);
  });

  it('sends a login as HTTP Basic, and asks the app to send it with the audio', async () => {
    const origin = 'http://nas.local:8080';
    const expected = `Basic ${Buffer.from('kåre:pass:word', 'utf8').toString('base64')}`;
    const { list, asked } = run(
      { url: `${origin}/opds`, user: 'kåre', password: 'pass:word' },
      (url, headers, asked) =>
        headers.Authorization === expected
          ? calibre(origin)(url, headers, asked)
          : { status: 401, body: '', type: 'text/plain' },
    );
    const result = await list();
    expect(result.headers).toEqual({ Authorization: expected });
    expect(result.files.filter((f) => !f.path.endsWith('cover.jpg'))).toHaveLength(2);
    expect(asked.every((a) => a.headers.Authorization === expected)).toBe(true);
  });

  it('says when the password is wrong, and when the catalog asks for a login', async () => {
    const refuse: Server = () => ({ status: 401, body: '', type: 'text/plain' });
    await expect(
      run({ url: 'http://nas.local/opds', user: 'me', password: 'wrong' }, refuse).list(),
    ).rejects.toThrow('The catalog refused the user name or password.');
    await expect(run({ url: 'http://nas.local/opds' }, refuse).list()).rejects.toThrow(
      'This catalog asks for a login. Enter the user name and password.',
    );
  });

  it('honours an OPDS authentication document: Basic is fine, other kinds are named', async () => {
    const document = (types: string[]): Reply => ({
      status: 401,
      type: 'application/opds-authentication+json',
      body: JSON.stringify({
        id: 'https://books.example.org/auth',
        title: 'Library login',
        authentication: types.map((type) => ({ type })),
      }),
    });
    await expect(
      run({ url: 'https://books.example.org/opds' }, () =>
        document(['http://opds-spec.org/auth/basic']),
      ).list(),
    ).rejects.toThrow('This catalog asks for a login.');
    await expect(
      run({ url: 'https://books.example.org/opds', user: 'a', password: 'b' }, () =>
        document(['http://opds-spec.org/auth/oauth/implicit']),
      ).list(),
    ).rejects.toThrow('a kind of login Lelap can’t do yet');
  });

  it('leaves out a feed or manifest that is gone, but fails on a server error', async () => {
    const feed = (status: number) => (url: string) => {
      const { pathname } = new URL(url);
      if (pathname === '/opds') {
        return atom(`<feed xmlns="http://www.w3.org/2005/Atom"><id>r</id>
          <entry><title>Old</title><id>o</id><link href="/old" type="application/atom+xml;profile=opds-catalog"/></entry>
          <entry><title>Web</title><id>w</id><link href="/web" type="application/atom+xml;profile=opds-catalog"/></entry>
          <entry><title>Talk</title><id>t</id><updated>0001-01-01T00:00:00Z</updated>
            <link rel="http://opds-spec.org/acquisition" href="/a.mp3" type="audio/mpeg"/></entry>
          <entry><title>Lost</title><id>l</id>
            <link rel="http://opds-spec.org/acquisition" href="/lost.json" type="application/audiobook+json"/></entry>
        </feed>`);
      }
      if (pathname === '/web')
        return { status: 200, body: '<html><p>Hi</p></html>', type: 'text/html' };
      return { status, body: '', type: 'text/plain' };
    };
    const { list } = run({ url: 'http://nas.local/opds' }, feed(404));
    const result = await list();
    // A date before 1970, as some servers write for “none”, is left out rather than refused.
    expect(result.files).toEqual([
      expect.objectContaining({
        path: 'Unknown author/Talk/Talk.mp3',
        url: 'http://nas.local/a.mp3',
      }),
    ]);
    expect(result.files[0]?.modifiedAt).toBeUndefined();
    await expect(run({ url: 'http://nas.local/opds' }, feed(503)).list()).rejects.toThrow(
      'The catalog answered HTTP 503',
    );
  });

  it('says when the address is a web page instead of a feed', async () => {
    await expect(
      run({ url: 'http://192.168.1.20:8080' }, () => ({
        status: 200,
        body: '<!doctype html><html><body><p>calibre</p></body></html>',
        type: 'text/html',
      })).list(),
    ).rejects.toThrow('add /opds to its address');
  });

  it('explains Calibre’s Digest-only login, which turns a Basic login down with 400', async () => {
    await expect(
      run({ url: 'http://192.168.1.20:8080/opds', user: 'me', password: 'pw' }, () => ({
        status: 400,
        body: 'Unsupported authentication method',
        type: 'text/plain',
      })).list(),
    ).rejects.toThrow('authentication mode set to Basic');
  });

  it('stops a catalog past the page limit with a clear message', async () => {
    // An endless catalog of ebooks, one page after another.
    const { list, asked } = run({ url: 'https://big.example.org/opds' }, (url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? '0');
      return atom(`<feed xmlns="http://www.w3.org/2005/Atom"><id>big</id>
        <link rel="next" href="/opds?page=${page + 1}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
        <entry><title>Book ${page}</title><id>urn:book:${page}</id>
          <link rel="http://opds-spec.org/acquisition" href="/b/${page}.epub" type="application/epub+zip"/></entry>
      </feed>`);
    });
    await expect(list()).rejects.toThrow(
      'This catalog is larger than Lelap reads: it stopped after 2,000 pages.',
    );
    expect(asked).toHaveLength(2000);
  });

  it('stops a catalog past the book limit', async () => {
    const entries = (from: number) =>
      Array.from(
        { length: 500 },
        (_, i) => `<entry><title>Talk ${from + i}</title><id>urn:talk:${from + i}</id>
          <link rel="http://opds-spec.org/acquisition/open-access" href="/a/${from + i}.mp3" type="audio/mpeg"/></entry>`,
      ).join('');
    const { list } = run({ url: 'https://talks.example.org/opds' }, (url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? '0');
      return atom(`<feed xmlns="http://www.w3.org/2005/Atom"><id>talks</id>
        <link rel="next" href="/opds?page=${page + 1}" type="application/atom+xml;profile=opds-catalog"/>
        ${entries(page * 500)}</feed>`);
    });
    await expect(list()).rejects.toThrow('it stopped after 10,000 audiobooks.');
  });

  it('scans in calls of a few feeds, with a short first call for the login check', async () => {
    const { call, list } = run({ url: 'https://pages.example.org/opds' }, (url) => {
      const page = Number(new URL(url).searchParams.get('page') ?? '0');
      return atom(`<feed xmlns="http://www.w3.org/2005/Atom"><id>p</id>
        ${page < 99 ? `<link rel="next" href="/opds?page=${page + 1}" type="application/atom+xml"/>` : ''}
        <entry><title>Part ${page}</title><id>urn:p:${page}</id>
          <link rel="http://opds-spec.org/acquisition" href="/a/${page}.m4b" type="audio/mp4"/></entry></feed>`);
    });
    const first = await call();
    expect(first.files).toHaveLength(4);
    expect(first.next).toBeDefined();
    const all = await list();
    expect(all.files).toHaveLength(100);
    expect(all.calls).toBe(4);
    await expect(call('scan-unknown')).rejects.toThrow('The scan was interrupted.');
  });

  it('follows a crawlable feed instead of every navigation link, and reads Atom entities', async () => {
    const { list, asked } = run({ url: 'https://lib.example.org/opds/' }, (url) => {
      const { pathname } = new URL(url);
      if (pathname === '/opds/') {
        return atom(`<?xml version="1.0"?><atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
          <atom:id>root</atom:id>
          <atom:link rel="http://opds-spec.org/crawlable" href="all.xml" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
          <atom:entry><atom:title>Fiction</atom:title><atom:id>f</atom:id>
            <atom:link rel="subsection" href="fiction.xml" type="application/atom+xml;profile=opds-catalog;kind=navigation"/></atom:entry>
        </atom:feed>`);
      }
      if (pathname === '/opds/all.xml') {
        return atom(`<feed xmlns="http://www.w3.org/2005/Atom"><id>all</id>
          <entry><title type="html">Tom &amp;amp; Jerry &lt;i&gt;live&lt;/i&gt;</title><id>t</id>
            <author><name>Søren &#x26; Co</name></author>
            <link rel="http://opds-spec.org/acquisition/open-access" href="/a/t.ogg" type="audio/ogg"/>
            <link rel="http://opds-spec.org/acquisition/sample" href="/a/t-sample.mp3" type="audio/mpeg"/></entry>
        </feed>`);
      }
      return missing;
    });
    const result = await list();
    expect(result.files.map((f) => f.path)).toEqual([
      'Søren & Co/Tom & Jerry live/Tom & Jerry live.ogg',
    ]);
    expect(asked.some((a) => a.url.includes('fiction'))).toBe(false);
  });
});

// M135: Digest logins, a book's summary, language and series, and OPDS Progression places.

const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');

/** A Calibre server with its default login without https: Digest only, Basic turned down. */
function digestOnly(origin: string, user: string, password: string): Server {
  const realm = 'calibre';
  const nonce = 'b1a2c3';
  const challenge = {
    'www-authenticate': `Digest realm="${realm}", nonce="${nonce}", qop="auth", algorithm="MD5"`,
  };
  return (url, headers, asked) => {
    const auth = headers.Authorization ?? '';
    if (auth.startsWith('Basic '))
      return { status: 400, body: 'Unsupported authentication method', type: 'text/plain' };
    const params = Object.fromEntries(
      [...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)].map((m) => [m[1], m[2] ?? m[3]]),
    );
    const { pathname, search } = new URL(url);
    // As Calibre does: the `uri` must be this request's own path.
    const ok =
      auth.startsWith('Digest ') &&
      params.uri === pathname + search &&
      params.response ===
        md5(
          `${md5(`${user}:${realm}:${password}`)}:${nonce}:${params.nc}:${params.cnonce}:auth:${md5(`${asked.method}:${params.uri}`)}`,
        );
    if (!ok) return { status: 401, body: '', type: 'text/plain', headers: challenge };
    return calibre(origin)(url, headers, asked);
  };
}

describe('OPDS 2 (M135)', () => {
  it('answers Calibre’s Digest login for every feed, and hands the app the login for the audio', async () => {
    const origin = 'http://192.168.1.20:8080';
    const { list, asked } = run(
      { url: `${origin}/opds`, user: 'kåre', password: 'blå bær' },
      digestOnly(origin, 'kåre', 'blå bær'),
    );
    const result = await list();
    expect(result.files.filter((f) => !f.path.endsWith('cover.jpg'))).toHaveLength(2);
    expect(result.digest).toEqual({ username: 'kåre', password: 'blå bær' });
    expect(result.headers).toBeUndefined();
    // Basic once, asked without a login for the challenge once, then every feed answered at once
    // with its own path.
    const [basic, bare, ...feeds] = asked;
    expect(basic?.headers.Authorization).toMatch(/^Basic /);
    expect(bare?.headers.Authorization).toBeUndefined();
    expect(feeds.length).toBeGreaterThan(2);
    for (const feed of feeds) {
      const { pathname, search } = new URL(feed.url);
      expect(feed.headers.Authorization).toContain(`uri="${pathname}${search}"`);
    }
  });

  it('says the password is wrong when the Digest answer is turned down', async () => {
    const origin = 'http://192.168.1.20:8080';
    await expect(
      run(
        { url: `${origin}/opds`, user: 'kåre', password: 'wrong' },
        digestOnly(origin, 'kåre', 'right'),
      ).list(),
    ).rejects.toThrow('refused the user name or password');
  });

  it('takes a Calibre entry’s summary, language and series from its content', async () => {
    const feed = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <id>urn:calibre:x</id>
  <entry>
    <title>Dune</title>
    <author><name>Frank Herbert</name></author>
    <id>urn:uuid:1</id>
    <dc:language>en</dc:language>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">TAGS: Science Fiction<br/>SERIES: Dune [1]<br/><p>A desert planet.</p><p>Spice.</p></div></content>
    <link type="audio/mp4" href="/get/m4b/7/Lib" rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;
    const { list } = run({ url: 'http://nas.local/opds' }, () => atom(feed));
    const [file] = (await list()).files;
    expect(file).toMatchObject({
      description: 'A desert planet.\nSpice.',
      language: 'en',
      series: [{ name: 'Dune', position: '1' }],
    });
  });

  const PROGRESSION = 'application/opds-progression+json';
  const catalog = (progression: unknown, reply?: (asked: Asked) => Reply): Server => {
    const feed = {
      metadata: { title: 'Audiobooks' },
      publications: [
        {
          metadata: {
            title: 'Pride and Prejudice',
            author: 'Jane Austen',
            identifier: 'urn:uuid:pp',
            description: '<p>A <b>novel</b> of manners.</p>',
            language: ['en', 'fr'],
            belongsTo: { series: [{ name: 'Austen Classics', position: 2 }] },
          },
          links: [
            { rel: 'http://opds-spec.org/progression', type: PROGRESSION, href: '/progress/pp' },
          ],
          readingOrder: [
            { href: '/audio/pp-1.mp3', type: 'audio/mpeg', duration: 1000 },
            { href: '/audio/pp-2.mp3', type: 'audio/mpeg', duration: 2000 },
          ],
        },
      ],
    };
    return (url, _headers, asked) => {
      const { pathname } = new URL(url);
      if (pathname === '/opds') return json(JSON.stringify(feed));
      if (pathname === '/progress/pp') {
        if (reply) return reply(asked);
        return { status: 200, body: JSON.stringify(progression), type: PROGRESSION };
      }
      return missing;
    };
  };

  it('reads an OPDS 2 book’s description, language and series, and its place from the progression service', async () => {
    const { list } = run(
      { url: 'https://books.example/opds' },
      catalog({
        modified: '2026-11-01T12:00:00Z',
        device: { id: 'urn:x:other', name: 'Other' },
        progression: 0.5,
        references: ['/audio/pp-2.mp3#t=500.25'],
      }),
    );
    const { files } = await list();
    expect(files[0]).toMatchObject({
      description: 'A novel of manners.',
      language: 'en',
      series: [{ name: 'Austen Classics', position: '2' }],
      ref: 'https://books.example/progress/pp',
    });
    expect(files[0]?.place).toBeUndefined();
    expect(files[1]).toMatchObject({
      ref: 'https://books.example/progress/pp',
      place: { positionMs: 500_250, at: Date.UTC(2026, 10, 1, 12) },
    });
    expect(files[1]).not.toHaveProperty('description');
  });

  it('places a time without a file, or a share of the book, on the right file', async () => {
    const at = '2026-11-01T12:00:00Z';
    const device = { id: 'urn:x:other', name: 'Other' };
    const time = await run(
      { url: 'https://books.example/opds' },
      catalog({ modified: at, device, progression: 0.9, references: ['#t=1500'] }),
    ).list();
    expect(time.files[1]?.place?.positionMs).toBe(500_000);
    const share = await run(
      { url: 'https://books.example/opds' },
      catalog({ modified: at, device, progression: 1 }),
    ).list();
    expect(share.files[1]?.place).toEqual({
      positionMs: 2_000_000,
      at: Date.parse(at),
      played: true,
    });
    // Nothing kept yet, or a broken answer: the book lists without a place.
    for (const reply of [
      () => ({ status: 200, body: '', type: PROGRESSION }),
      () => ({ status: 500, body: 'oops', type: 'text/plain' }),
      () => ({ status: 200, body: '{not json', type: PROGRESSION }),
    ]) {
      const { files } = await run(
        { url: 'https://books.example/opds' },
        catalog(null, reply),
      ).list();
      expect(files.map((f) => f.place)).toEqual([undefined, undefined]);
      expect(files).toHaveLength(2);
    }
  });

  it('saves a place to the progression service with the share of the book and the time in the file', async () => {
    const puts: Asked[] = [];
    let status = 200;
    const { report } = run(
      { url: 'https://books.example/opds' },
      catalog(null, (asked) => {
        if (asked.method === 'PUT') puts.push(asked);
        return { status, body: asked.body ?? '', type: PROGRESSION };
      }),
    );
    const [first, second] = [
      {
        path: 'Jane Austen/Pride/001.mp3',
        url: 'https://books.example/audio/pp-1.mp3',
        durationMs: 1_000_000,
        ref: 'https://books.example/progress/pp',
      },
      {
        path: 'Jane Austen/Pride/002.mp3',
        url: 'https://books.example/audio/pp-2.mp3',
        durationMs: 2_000_000,
        ref: 'https://books.example/progress/pp',
      },
    ];
    const files = [first, second];
    const place: PlaceReport = {
      file: second,
      files,
      positionMs: 500_250,
      at: Date.UTC(2026, 10, 2, 8),
      finished: false,
    };
    expect(await report({ place })).toEqual({ saved: true });
    expect(puts).toHaveLength(1);
    expect(puts[0]?.headers['Content-Type']).toBe(PROGRESSION);
    expect(JSON.parse(puts[0]?.body ?? '')).toEqual({
      modified: '2026-11-02T08:00:00.000Z',
      device: { id: 'urn:x-lelap:app', name: 'Lelap' },
      progression: 0.500083,
      references: ['https://books.example/audio/pp-2.mp3#t=500.250'],
    });
    expect(
      JSON.parse((await report({ place: { ...place, finished: true } }), puts[1]?.body ?? ''))
        .progression,
    ).toBe(1);
    // Without every file's length the share would be a guess: nothing is sent yet.
    const unsure = files.map((f, i) => (i === 1 ? { path: f.path, url: f.url, ref: f.ref } : f));
    expect(await report({ place: { ...place, file: unsure[1] ?? second, files: unsure } })).toEqual(
      { saved: false },
    );
    expect(puts).toHaveLength(2);
    // A newer place on the server is no failure; a server error is tried again later.
    status = 409;
    expect(await report({ place })).toEqual({ saved: false });
    status = 503;
    await expect(report({ place })).rejects.toThrow('HTTP 503');
    // A book without a progression service, or one on another server, saves nothing.
    const plain = files.map((f) => ({ path: f.path, url: f.url, durationMs: f.durationMs }));
    expect(await report({ place: { ...place, file: plain[1] ?? second, files: plain } })).toEqual({
      saved: false,
    });
    const away = files.map((f) => ({ ...f, ref: 'https://elsewhere.example/p' }));
    expect(await report({ place: { ...place, file: away[1] ?? second, files: away } })).toEqual({
      saved: false,
    });
  });
});
