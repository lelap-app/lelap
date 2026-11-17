import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { getBook, listBooks } from '../library/queries';
import {
  addRemoteRoot,
  applyScan,
  listRoots,
  remoteName,
  setAudiobookshelfKeyRefused,
  updateRemoteRoot,
} from '../library/scan';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import type { RemoteSource } from '../schema';
import {
  audiobookshelfItemId,
  audiobookshelfItemProgress,
  audiobookshelfPlaces,
  audiobookshelfMe,
  audiobookshelfScan,
  type AudiobookshelfSource,
  audiobookshelfStream,
  isKeyRefused,
  listAudiobookshelfItems,
  listAudiobookshelfLibraries,
  reportAudiobookshelfProgress,
} from './audiobookshelf';
import { applyRemotePlaces, setRemoteCovers } from './places';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../test/fixtures/audiobookshelf/${name}`, import.meta.url), 'utf8'),
  );

const source: AudiobookshelfSource = {
  url: 'https://media.example.org/audiobookshelf/',
  username: 'reader',
  userId: 'usr_reader',
  token: 'api-key-1',
  libraryIds: ['lib_books'],
  profileId: ME,
};
const BEARER = source.token;
const ROOT = 'audiobookshelf:media.example.org/audiobookshelf';

type Seen = { url: URL; init: RequestInit | undefined };

/** A fake server answering from the recorded fixtures. */
function server(routes: (url: URL, init?: RequestInit) => Response | null) {
  const seen: Seen[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    seen.push({ url: parsed, init });
    return routes(parsed, init) ?? new Response('', { status: 404 });
  };
  return { seen, fetcher };
}

const json = (body: unknown) => Response.json(body);
const headerOf = (s: Seen | undefined, name: string) =>
  (s?.init?.headers as Record<string, string> | undefined)?.[name];

function library(url: URL): Response | null {
  if (url.pathname === '/audiobookshelf/api/libraries/lib_books/items') {
    return json(fixture('items-page.json'));
  }
  if (url.pathname === '/audiobookshelf/api/items/batch/get') return json(fixture('batch.json'));
  if (url.pathname === '/audiobookshelf/api/me') return json(fixture('me.json'));
  return null;
}

async function scanOf() {
  const { fetcher } = server(library);
  const items = await listAudiobookshelfItems(fetcher, source, BEARER);
  const me = await audiobookshelfMe(fetcher, source.url, BEARER);
  return audiobookshelfScan(source, items, me.mediaProgress);
}

describe('Audiobookshelf', () => {
  it('checks the API key with /api/me, and says to ask for a new one when refused', async () => {
    const ok = server((url) =>
      url.pathname === '/audiobookshelf/api/me' ? json(fixture('me.json')) : null,
    );
    const me = await audiobookshelfMe(ok.fetcher, source.url, source.token);
    expect(me).toMatchObject({ id: 'usr_reader', username: 'reader' });
    expect(headerOf(ok.seen[0], 'Authorization')).toBe('Bearer api-key-1');
    const refused = server(() => new Response('Unauthorized', { status: 401 }));
    await expect(audiobookshelfMe(refused.fetcher, source.url, 'old')).rejects.toThrow(
      'refused the API key (HTTP 401). Ask for a new key',
    );
    const other = server(() => json({ hello: 'world' }));
    await expect(audiobookshelfMe(other.fetcher, source.url, 'k')).rejects.toThrow(
      'does not answer like Audiobookshelf',
    );
  });

  it('pages through every picked library before fetching the books', async () => {
    const page = fixture('items-page.json') as { results: unknown[] };
    const { seen, fetcher } = server((url) => {
      if (url.pathname.endsWith('/api/items/batch/get')) return json({ libraryItems: [] });
      const n = Number(url.searchParams.get('page'));
      // 450 books in the first library: three pages of 200, the last short.
      if (url.pathname.includes('/lib_books/')) {
        return json({
          results: Array.from({ length: n < 2 ? 200 : 50 }, (_, i) => ({ id: `b${n}-${i}` })),
          total: 450,
        });
      }
      return json({ ...page, total: 2 });
    });
    await listAudiobookshelfItems(
      fetcher,
      { ...source, libraryIds: ['lib_books', 'lib_more'] },
      BEARER,
    );
    const pages = seen.filter((s) => s.url.pathname.endsWith('/items'));
    expect(
      pages.map((s) => [s.url.pathname.split('/')[4], s.url.searchParams.get('page')]),
    ).toEqual([
      ['lib_books', '0'],
      ['lib_books', '1'],
      ['lib_books', '2'],
      ['lib_more', '0'],
    ]);
    const batches = seen.filter((s) => s.url.pathname.endsWith('/batch/get'));
    expect(batches).toHaveLength(Math.ceil(452 / 50));
  });

  it('reads the place in one book, and turns it into a place in its files', async () => {
    const { fetcher } = server((url) =>
      url.pathname.endsWith('/api/me/progress/li_carol')
        ? json((fixture('me.json') as { mediaProgress: unknown[] }).mediaProgress[1])
        : null,
    );
    const progress = await audiobookshelfItemProgress(fetcher, source.url, BEARER, 'li_carol');
    expect(progress?.currentTime).toBe(1500.5);
    expect(await audiobookshelfItemProgress(fetcher, source.url, BEARER, 'li_new')).toBeNull();
    const files = [
      { location: 'a', durationMs: 1_200_000 },
      { location: 'b', durationMs: 1_800_000 },
    ];
    if (!progress) throw new Error('no progress');
    expect(audiobookshelfPlaces(progress, files)).toEqual([
      { fileLocation: 'b', positionMs: 300_500, played: false, at: 1_794_873_600_000 },
    ]);
  });

  it('lists book libraries only, with the bearer token', async () => {
    const { seen, fetcher } = server((url) =>
      url.pathname === '/audiobookshelf/api/libraries' ? json(fixture('libraries.json')) : null,
    );
    expect(await listAudiobookshelfLibraries(fetcher, source.url, BEARER)).toEqual([
      { id: 'lib_books', name: 'Audiobooks' },
    ]);
    expect(headerOf(seen[0], 'Authorization')).toBe(`Bearer ${BEARER}`);
  });

  it('lists the books, then fetches them in full, and turns tracks into files', async () => {
    const { seen, fetcher } = server(library);
    const items = await listAudiobookshelfItems(fetcher, source, BEARER);
    expect(items.map((i) => i.media.metadata?.title)).toEqual([
      'A Christmas Carol',
      'The Time Machine',
    ]);
    expect(seen[0]?.url.searchParams.get('page')).toBe('0');
    expect(JSON.parse(String(seen[1]?.init?.body))).toEqual({
      libraryItemIds: ['li_carol', 'li_machine'],
    });

    const scan = await scanOf();
    expect(scan.listed.map((f) => [f.location, f.relPath, f.uri])).toEqual([
      [
        `${ROOT}/li_carol/649523`,
        'li_carol/0001 01 Stave One.mp3',
        'https://media.example.org/audiobookshelf/api/items/li_carol/file/649523',
      ],
      [
        `${ROOT}/li_carol/649524`,
        'li_carol/0002 02 Stave Two.mp3',
        'https://media.example.org/audiobookshelf/api/items/li_carol/file/649524',
      ],
      [
        `${ROOT}/li_machine/649531`,
        'li_machine/0001 The Time Machine.m4b',
        'https://media.example.org/audiobookshelf/api/items/li_machine/file/649531',
      ],
    ]);
    const stave2 = scan.tags.get(`${ROOT}/li_carol/649524`);
    expect(stave2).toMatchObject({
      durationMs: 1_800_000,
      title: 'Stave Two: The First of the Three Spirits',
      album: 'A Christmas Carol',
      albumArtist: 'Charles Dickens',
      chapters: [],
    });
    expect(scan.tags.get(`${ROOT}/li_machine/649531`)?.chapters).toEqual([
      { title: 'Introduction', startMs: 0 },
      { title: 'Chapter 1', startMs: 900_000 },
      { title: 'Chapter 3', startMs: 2_400_000 },
    ]);
    expect([...scan.covers]).toEqual([
      [`${ROOT}/li_carol`, 'https://media.example.org/audiobookshelf/api/items/li_carol/cover'],
    ]);
    // Book time in seconds becomes a place in the part it falls in; podcast episodes are skipped.
    expect(scan.places).toEqual([
      {
        fileLocation: `${ROOT}/li_machine/649531`,
        positionMs: 60_000,
        played: false,
        at: 1_794_787_200_000,
      },
      {
        fileLocation: `${ROOT}/li_carol/649524`,
        positionMs: 300_500,
        played: false,
        at: 1_794_873_600_000,
      },
    ]);
    expect(audiobookshelfItemId(`${ROOT}/li_carol/649524`)).toBe('li_carol');
    expect(audiobookshelfItemId('jellyfin:x/y/z')).toBeNull();
  });

  it('streams with the token as a header, or in the address', () => {
    const uri = 'https://media.example.org/audiobookshelf/api/items/li_carol/file/649523';
    expect(audiobookshelfStream('tok', uri, true)).toEqual({
      uri,
      headers: { Authorization: 'Bearer tok' },
    });
    expect(audiobookshelfStream('t k', uri, false)).toEqual({
      uri: `${uri}?token=t%20k`,
      headers: {},
    });
  });

  it('reports the place in seconds of the whole book, and finished books', async () => {
    const { seen, fetcher } = server((_url, init) =>
      init?.method === 'PATCH' ? new Response(null, { status: 200 }) : null,
    );
    const place = { positionMs: 1_500_500, durationMs: 3_000_000 };
    await reportAudiobookshelfProgress(fetcher, source.url, BEARER, 'li_carol', {
      ...place,
      finished: false,
    });
    await reportAudiobookshelfProgress(fetcher, source.url, BEARER, 'li_carol', {
      ...place,
      finished: true,
    });
    expect(seen[0]?.url.pathname).toBe('/audiobookshelf/api/me/progress/li_carol');
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      currentTime: 1500.5,
      duration: 3000,
      progress: 0.5001666666666666,
      isFinished: false,
    });
    expect(JSON.parse(String(seen[1]?.init?.body))).toEqual({ isFinished: true });
    const failing = server(() => new Response('', { status: 500 }));
    await expect(
      reportAudiobookshelfProgress(failing.fetcher, source.url, BEARER, 'x', {
        ...place,
        finished: false,
      }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('Audiobookshelf in the library', () => {
  let n = 0;
  const newId = () => `id-${++n}`;

  async function scanned() {
    const db = createTestDb();
    const remote: RemoteSource = { type: 'audiobookshelf', ...source };
    const rootId = addRemoteRoot(db, remote, 1, newId);
    const root = listRoots(db).find((r) => r.id === rootId);
    const scan = await scanOf();
    applyScan(db, {
      rootId,
      rootLocation: root?.location ?? '',
      listed: scan.listed,
      tags: scan.tags,
      folderCovers: new Map(),
      now: 2,
      newId,
    });
    setRemoteCovers(db, rootId, scan.covers, 3);
    return { db, rootId, root, scan };
  }

  it('makes one book of each item, with chapters, authors and covers', async () => {
    const { db, root } = await scanned();
    expect(root?.location).toBe(ROOT);
    expect(root?.needsLogin).toBe(false);
    expect(remoteName({ type: 'audiobookshelf', ...source })).toBe(
      'reader@media.example.org/audiobookshelf',
    );
    const books = listBooks(db, ME, 'title');
    expect(books.map((b) => [b.title, b.author, b.durationMs])).toEqual([
      ['A Christmas Carol', 'Charles Dickens', 3_000_000],
      ['The Time Machine', 'H. G. Wells', 3_600_000],
    ]);
    const carol = getBook(db, ME, books[0]?.id ?? '');
    expect(carol?.files.map((f) => f.name)).toEqual(['01 Stave One.mp3', '02 Stave Two.mp3']);
    expect(carol?.chapters.map((c) => [c.title, c.startMs])).toEqual([
      ["Stave One: Marley's Ghost", 0],
      ['Stave Two: The First of the Three Spirits', 1_200_000],
    ]);
    expect(carol?.book.coverUrl).toBe(
      'https://media.example.org/audiobookshelf/api/items/li_carol/cover',
    );
    expect(getBook(db, ME, books[1]?.id ?? '')?.chapters).toHaveLength(3);
  });

  it("takes the server's place when it is newer, and keeps a newer one of Lelap's", async () => {
    const { db, scan } = await scanned();
    const [carol, machine] = listBooks(db, ME, 'title');
    saveProgress(
      db,
      ME,
      {
        bookId: machine?.id ?? '',
        fileLocation: `${ROOT}/li_machine/649531`,
        filePositionMs: 5_000,
        savedAt: 1_794_800_000_000,
      },
      'app',
    );
    expect(applyRemotePlaces(db, ME, scan.places, 10)).toBe(1);
    expect(getBook(db, ME, machine?.id ?? '')?.book.bookPositionMs).toBe(5_000);
    expect(getBook(db, ME, carol?.id ?? '')?.book.bookPositionMs).toBe(1_500_500);
  });

  it('finishes a book finished on the server', async () => {
    const { db } = await scanned();
    const { fetcher } = server(library);
    const items = await listAudiobookshelfItems(fetcher, source, BEARER);
    const scan = audiobookshelfScan(source, items, [
      {
        libraryItemId: 'li_carol',
        currentTime: 0,
        isFinished: true,
        lastUpdate: 500,
        finishedAt: 400,
      },
    ]);
    expect(scan.places).toHaveLength(2);
    const carol = listBooks(db, ME, 'title')[0];
    expect(applyRemotePlaces(db, ME, scan.places, 600)).toBe(1);
    expect(getBook(db, ME, carol?.id ?? '')?.book.finishedAt).toBe(400);
  });

  it('marks a refused key, keeps the sealed key and books, and clears the mark with a new key', async () => {
    const { db, rootId } = await scanned();
    const refused = server(() => new Response('', { status: 401 }));
    const error = await audiobookshelfMe(refused.fetcher, source.url, 'old').catch(
      (e: unknown) => e,
    );
    expect(isKeyRefused(error)).toBe(true);
    expect(isKeyRefused(new Error('offline'))).toBe(false);

    expect(setAudiobookshelfKeyRefused(db, rootId, true, 5)).toBe(true);
    expect(setAudiobookshelfKeyRefused(db, rootId, true, 6)).toBe(false);
    const marked = listRoots(db).find((r) => r.id === rootId);
    expect(marked?.remote).toMatchObject({ keyRefused: true, token: source.token });
    expect(listBooks(db, ME, 'title')).toHaveLength(2);

    // A request with the key worked again: the mark goes.
    expect(setAudiobookshelfKeyRefused(db, rootId, false, 7)).toBe(true);
    expect(listRoots(db).find((r) => r.id === rootId)?.remote).not.toHaveProperty('keyRefused');

    // Change key: the new key replaces the old in place, without the mark; books stay.
    setAudiobookshelfKeyRefused(db, rootId, true, 8);
    updateRemoteRoot(db, rootId, { type: 'audiobookshelf', ...source, token: 'api-key-2' }, 9);
    const changed = listRoots(db).find((r) => r.id === rootId);
    expect(changed?.remote).toMatchObject({ token: 'api-key-2' });
    expect(changed?.remote).not.toHaveProperty('keyRefused');
    expect(listBooks(db, ME, 'title')).toHaveLength(2);
    expect(setAudiobookshelfKeyRefused(db, 'missing', true, 10)).toBe(false);
  });
});
