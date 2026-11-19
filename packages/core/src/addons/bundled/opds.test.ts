import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { LibraryResponse, readSettings, settingHosts } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { hostAllowed } from '../local';
import { bundledAddon } from './index';

// The OPDS add-on (M128) against fixture feeds: Calibre's OPDS 1 as its `opds.py` writes it, an
// OPDS 2 catalog with a Readium audiobook manifest, logins and a catalog past the limits.

const dir = new URL('./', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(`fixtures/opds/${name}`, dir), 'utf8');

type Reply = { status: number; body: string; type?: string };
type Server = (url: string, headers: Record<string, string>) => Reply;

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
  const asked: { url: string; headers: Record<string, string> }[] = [];
  let library: ((args: unknown) => Promise<unknown>) | null = null;
  runInNewContext(readFileSync(new URL('opds.js', dir), 'utf8'), {
    addon: (definition: { library: typeof library }) => {
      library = definition.library;
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
          headers: {
            get: (name: string) =>
              name.toLowerCase() === 'content-type' ? (reply.type ?? null) : null,
          },
          text: async () => reply.body,
        };
      },
    },
    URL,
    TextEncoder,
    btoa,
  });
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
  return { call, list, asked };
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
    expect(manifest?.resources).toEqual(['library']);
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
      (url, headers) =>
        headers.Authorization === expected
          ? calibre(origin)(url, headers)
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
