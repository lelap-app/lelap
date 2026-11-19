import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { getBook, listBooks } from '../library/queries';
import { addRemoteRoot, applyScan, listRoots, remoteName } from '../library/scan';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { saveProgress } from '../progress';
import type { RemoteSource } from '../schema';
import {
  jellyfinAuthorization,
  jellyfinItemId,
  jellyfinPeople,
  jellyfinScan,
  jellyfinStream,
  type JellyfinSource,
  listJellyfinItems,
  listJellyfinLibraries,
  markJellyfinPlayed,
  reportJellyfinProgress,
  signInJellyfin,
} from './jellyfin';
import { applyRemotePlaces, setRemoteCovers } from './places';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../test/fixtures/jellyfin/${name}`, import.meta.url), 'utf8'),
  );

const BOOKS = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const MUSIC = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';

const source: JellyfinSource = {
  url: 'https://media.example.org/jellyfin/',
  username: 'reader',
  userId: '6f1e2d3c4b5a69788796a5b4c3d2e1f0',
  deviceId: 'device-1',
  token: '0123456789abcdef0123456789abcdef',
  libraryIds: [BOOKS, MUSIC],
  profileId: ME,
};

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

function items(url: URL): Response | null {
  if (url.pathname !== '/jellyfin/Items') return null;
  if (url.searchParams.get('ParentId') === BOOKS) return json(fixture('items-books.json'));
  return json(
    fixture(
      url.searchParams.get('StartIndex') === '0' ? 'items-music-1.json' : 'items-music-2.json',
    ),
  );
}

describe('Jellyfin', () => {
  it('signs in with the MediaBrowser header and keeps only the token', async () => {
    const { seen, fetcher } = server((url) =>
      url.pathname === '/jellyfin/Users/AuthenticateByName'
        ? json(fixture('authenticate.json'))
        : null,
    );
    const result = await signInJellyfin(fetcher, {
      url: source.url,
      username: 'reader',
      password: 'pw',
      deviceId: 'device-1',
    });
    expect(result).toEqual({ userId: source.userId, token: source.token });
    expect(seen[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ Username: 'reader', Pw: 'pw' });
    expect(headerOf(seen[0], 'Authorization')).toBe(
      'MediaBrowser Client="Lelap", Device="Lelap", DeviceId="device-1", Version="1"',
    );
    expect(jellyfinAuthorization('a"b', 'tok')).toContain(
      'DeviceId="a_b", Version="1", Token="tok"',
    );
  });

  it('says so when the login is refused', async () => {
    const { fetcher } = server(() => new Response('', { status: 401 }));
    await expect(
      signInJellyfin(fetcher, { url: source.url, username: 'x', password: 'y', deviceId: 'd' }),
    ).rejects.toThrow('refused the login');
  });

  it('lists book and music libraries, falling back to the old route', async () => {
    const { seen, fetcher } = server((url) =>
      url.pathname === `/jellyfin/Users/${source.userId}/Views`
        ? json(fixture('views.json'))
        : null,
    );
    expect(await listJellyfinLibraries(fetcher, source)).toEqual([
      { id: BOOKS, name: 'Audiobooks', kind: 'books' },
      { id: MUSIC, name: 'Music', kind: 'music' },
    ]);
    expect(seen.map((s) => s.url.pathname)).toEqual([
      '/jellyfin/UserViews',
      `/jellyfin/Users/${source.userId}/Views`,
    ]);
    expect(headerOf(seen[0], 'Authorization')).toContain(`Token="${source.token}"`);
  });

  it('pages through the picked libraries and turns items into books', async () => {
    const { seen, fetcher } = server(items);
    const list = await listJellyfinItems(fetcher, source);
    expect(list.map((i) => i.Name)).toEqual(['The Time Machine', 'Part 2', 'Part 1']);
    expect(seen.map((s) => s.url.searchParams.get('StartIndex'))).toEqual(['0', '0', '500']);
    expect(seen[0]?.url.searchParams.get('Fields')).toContain('Chapters');

    const scan = jellyfinScan(source, list);
    const root = 'jellyfin:media.example.org/jellyfin';
    expect(scan.listed.map((f) => [f.location, f.relPath, f.name])).toEqual([
      [
        `${root}/fff0000000000000000000000000000f/aaa0000000000000000000000000000a`,
        'fff0000000000000000000000000000f/000-0000 The Time Machine.m4b',
        'The Time Machine.m4b',
      ],
      [
        `${root}/eee0000000000000000000000000000e/ccc0000000000000000000000000000c`,
        'eee0000000000000000000000000000e/000-0002 02 Part 2.mp3',
        '02 Part 2.mp3',
      ],
      [
        `${root}/eee0000000000000000000000000000e/bbb0000000000000000000000000000b`,
        'eee0000000000000000000000000000e/000-0001 01 Part 1.mp3',
        '01 Part 1.mp3',
      ],
    ]);
    expect(scan.listed[0]?.uri).toBe(
      'https://media.example.org/jellyfin/Audio/aaa0000000000000000000000000000a/stream?static=true',
    );
    const machine = scan.tags.get(scan.listed[0]?.location ?? '');
    expect(machine?.durationMs).toBe(12_600_000);
    expect(machine?.chapters).toEqual([
      { title: 'Introduction', startMs: 0 },
      { title: 'Chapter 1', startMs: 900_000 },
      { title: '', startMs: 4_500_000 },
    ]);
    // No album tag: named after the folder on the server.
    expect(scan.tags.get(scan.listed[1]?.location ?? '')?.album).toBe('Loose tracks');
    expect(jellyfinPeople(list[0] as (typeof list)[number])).toEqual({
      authors: ['H. G. Wells'],
      narrators: ['Mark Nelson'],
    });
    expect(scan.covers.get(`${root}/eee0000000000000000000000000000e`)).toBe(
      'https://media.example.org/jellyfin/Items/eee0000000000000000000000000000e/Images/Primary?maxHeight=600',
    );
    expect(scan.places).toEqual([
      {
        fileLocation: scan.listed[0]?.location,
        positionMs: 60_000,
        played: false,
        at: Date.parse('2026-11-10T20:00:00Z'),
      },
      {
        fileLocation: scan.listed[2]?.location,
        positionMs: 0,
        played: true,
        at: Date.parse('2026-11-12T08:00:00Z'),
      },
    ]);
    expect(jellyfinItemId(scan.listed[2]?.location ?? '')).toBe('bbb0000000000000000000000000000b');
  });

  it('streams the original file with the token as a header, or in the address', () => {
    const uri = 'https://media.example.org/jellyfin/Audio/x/stream?static=true';
    expect(jellyfinStream(source, uri, true).headers.Authorization).toContain('Token=');
    expect(jellyfinStream(source, uri, false)).toEqual({
      uri: `${uri}&api_key=${source.token}`,
      headers: {},
    });
  });

  it('reports progress in ticks and marks items played', async () => {
    const { seen, fetcher } = server((url, init) =>
      init?.method === 'POST' && !url.pathname.startsWith('/jellyfin/UserPlayedItems')
        ? new Response(null, { status: 204 })
        : null,
    );
    await reportJellyfinProgress(fetcher, source, 'item', 61_234, 'pause');
    await markJellyfinPlayed(fetcher, source, 'item');
    expect(seen[0]?.url.pathname).toBe('/jellyfin/Sessions/Playing/Progress');
    expect(JSON.parse(String(seen[0]?.init?.body))).toMatchObject({
      ItemId: 'item',
      PositionTicks: 612_340_000,
      IsPaused: true,
      PlayMethod: 'DirectPlay',
    });
    expect(seen.slice(1).map((s) => s.url.pathname)).toEqual([
      '/jellyfin/UserPlayedItems/item',
      `/jellyfin/Users/${source.userId}/PlayedItems/item`,
    ]);
  });
});

describe('Jellyfin in the library', () => {
  let n = 0;
  const newId = () => `id-${++n}`;

  async function scanned() {
    const db = createTestDb();
    const remote: RemoteSource = { type: 'jellyfin', ...source };
    const rootId = addRemoteRoot(db, remote, 1, newId);
    const root = listRoots(db).find((r) => r.id === rootId);
    const { fetcher } = server(items);
    const scan = jellyfinScan(source, await listJellyfinItems(fetcher, source));
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

  it('keeps the token sealed like a password and makes books from albums and folders', async () => {
    const { db, root } = await scanned();
    expect(root?.remote).toMatchObject({ type: 'jellyfin', token: source.token });
    expect(root?.location).toBe('jellyfin:media.example.org/jellyfin');
    expect(remoteName({ type: 'jellyfin', ...source })).toBe('reader@media.example.org/jellyfin');
    const books = listBooks(db, ME, 'title');
    expect(books.map((b) => [b.title, b.author, b.durationMs])).toEqual([
      ['Loose tracks', 'Charles Dickens', 3_000_000],
      ['The Time Machine', 'H. G. Wells', 12_600_000],
    ]);
    const dickens = getBook(db, ME, books[0]?.id ?? '');
    expect(dickens?.files.map((f) => f.name)).toEqual(['01 Part 1.mp3', '02 Part 2.mp3']);
    expect(dickens?.book.coverUrl).toContain('/Items/eee0000000000000000000000000000e/Images');
    expect(getBook(db, ME, books[1]?.id ?? '')?.chapters).toHaveLength(3);
  });

  it("takes the server's places when they are newer, and keeps newer ones of Lelap's", async () => {
    const { db, scan } = await scanned();
    const [machine, dickens] = listBooks(db, ME, 'title').reverse();
    const machineFile = scan.listed[0]?.location ?? '';
    // Lelap's own place in The Time Machine is newer than the server's.
    saveProgress(
      db,
      ME,
      {
        bookId: machine?.id ?? '',
        fileLocation: machineFile,
        filePositionMs: 5_000,
        savedAt: Date.parse('2026-11-11T00:00:00Z'),
      },
      'app',
    );
    expect(applyRemotePlaces(db, ME, scan.places, 10)).toBe(1);
    expect(getBook(db, ME, machine?.id ?? '')?.book.bookPositionMs).toBe(5_000);
    // Part 1 was played on the server: the place moves to the start of part 2.
    const detail = getBook(db, ME, dickens?.id ?? '');
    expect(detail?.book.bookPositionMs).toBe(1_200_000);

    // An older Lelap place loses to the server's.
    saveProgress(
      db,
      ME,
      {
        bookId: machine?.id ?? '',
        fileLocation: machineFile,
        filePositionMs: 1_000,
        savedAt: Date.parse('2026-11-01T00:00:00Z'),
      },
      'journal',
    );
    const newer = scan.places.map((p) =>
      p.fileLocation === machineFile ? { ...p, at: Date.parse('2026-11-15T00:00:00Z') } : p,
    );
    applyRemotePlaces(db, ME, newer, 11);
    expect(getBook(db, ME, machine?.id ?? '')?.book.bookPositionMs).toBe(60_000);
  });

  it('finishes a book whose parts are all played on the server', async () => {
    const { db, scan } = await scanned();
    const dickens = listBooks(db, ME, 'title')[0];
    const played = scan.listed.slice(1).map((f, i) => ({
      fileLocation: f.location,
      positionMs: 0,
      played: true,
      at: 100 + i,
    }));
    expect(applyRemotePlaces(db, ME, played, 200)).toBe(1);
    expect(getBook(db, ME, dickens?.id ?? '')?.book.finishedAt).toBe(101);
  });
});

describe('ISBN and ASIN from Jellyfin', () => {
  it('come from the provider IDs; the Audible plugins call the ASIN Audible', () => {
    const scan = jellyfinScan(source, [
      { Id: 'a', Name: 'Dune', ProviderIds: { Isbn: '9780441013593', Audible: 'B002V1OF70' } },
      { Id: 'b', Name: 'Other', ProviderIds: { MusicBrainzAlbum: 'x' } },
    ]);
    expect([...scan.tags.values()].map((t) => t.ids)).toEqual([
      ['isbn:9780441013593', 'asin:B002V1OF70'],
      [],
    ]);
  });
});

describe('series from Jellyfin', () => {
  it('come from an audiobook’s series name, never from music', () => {
    const scan = jellyfinScan(source, [
      { Id: 'a', Name: 'Dune', Type: 'AudioBook', SeriesName: ' Dune Chronicles ' },
      { Id: 'b', Name: 'Song', Type: 'Audio', SeriesName: 'Best of' },
      { Id: 'c', Name: 'Alone', Type: 'AudioBook' },
    ]);
    expect([...scan.tags.values()].map((t) => t.kindTags?.series)).toEqual([
      'Dune Chronicles',
      null,
      null,
    ]);
  });
});
