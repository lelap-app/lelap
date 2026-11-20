import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs from 'sql.js';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { bigScan } from '../test/bigScan';
import { seedBigLibrary } from '../src/bigLibrary';
import { carShelves } from '../src/car';
import { type ChunkStore, ChunkedFile } from '../src/chunkedFile';
import { listDownloads } from '../src/downloads';
import { groupByProgress } from '../src/library/byProgress';
import { hiddenCount } from '../src/library/hidden';
import { musicSuggestions } from '../src/library/musicSuggestions';
import { continueListening, listAllBooks, listBooks, listBooksFrom } from '../src/library/queries';
import { libraryBooks } from '../src/library/bookChanges';
import { groupIntoBooks } from '../src/library/group';
import { applyScan, filesNeedingTags, listRoots, localRoot, upsertRoot } from '../src/library/scan';
import { listPlaylistsWithCounts, listTags } from '../src/organise';
import { listEpisodes, listSubscriptions } from '../src/podcasts/repository';
import { DEFAULT_PROFILE_ID as ME } from '../src/profiles';
import * as schema from '../src/schema';
import { saveProgress } from '../src/progress';
import { getSettings } from '../src/settings';
import { bookIdForKey, bookKey } from '../src/sync/keys';

// What the Library, Home and Podcasts screens, the web app's database and the folder scan cost
// with M43's 10,000 books and 500 podcasts. `pnpm --filter @lelap/core bench`; the numbers are in
// docs/milestones/m43.md and m106.md.
//
// Rows with a budget (M106) fail the run when their median is over it. Budgets are about three
// times the median on the Mac in docs/milestones/m106.md, so only a clear slide fails, not a busy
// machine. The bench is not part of pull request CI.

type Result = { what: string; value: number; unit: 'ms' | 'MB'; budget?: number | undefined };
const results: Result[] = [];

function measure(what: string, run: () => unknown, runs = 15, budget?: number): void {
  run();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  results.push({ what, value: Math.round(median * 10) / 10, unit: 'ms', budget });
}

async function measureAsync(
  what: string,
  run: () => Promise<unknown>,
  runs: number,
  budget?: number,
): Promise<void> {
  await run();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  results.push({ what, value: Math.round(median * 10) / 10, unit: 'ms', budget });
}

afterAll(() => {
  const lines = results.map((r) => {
    const over = r.budget !== undefined && r.value > r.budget;
    const budget =
      r.budget === undefined ? '' : `  budget ${r.budget} ${r.unit}${over ? '  OVER' : ''}`;
    return `${r.what.padEnd(48)} ${String(r.value).padStart(9)} ${r.unit}${budget}`;
  });
  process.stdout.write(`\nMedian per run:\n${lines.join('\n')}\n\n`);
  const over = results.filter((r) => r.budget !== undefined && r.value > r.budget);
  expect(
    over.map((r) => `${r.what}: ${r.value} ${r.unit}, budget ${r.budget} ${r.unit}`),
    'over budget',
  ).toEqual([]);
});

describe('10,000 books, 500 podcasts', () => {
  const db = createTestDb();
  seedBigLibrary(db, ME);

  it('Library screen', () => {
    // Everything the Library tab reads before its first rows show (`app/(tabs)/library.tsx`).
    measure(
      'Library screen, first draw',
      () => {
        localRoot(db);
        listRoots(db);
        const all = listAllBooks(db, ME);
        groupByProgress(listBooksFrom(db, ME, all, 'recent'));
        getSettings(db, ME);
        hiddenCount(db, ME);
        musicSuggestions(db, ME);
        continueListening(db, ME);
        listPlaylistsWithCounts(db, ME, all);
        listTags(db, ME);
      },
      15,
      200,
    );
    measure('Library screen: books, continue, lists, tags', () => {
      groupByProgress(listBooks(db, ME, 'recent'));
      continueListening(db, ME);
      listPlaylistsWithCounts(db, ME);
      listTags(db, ME);
    });
    measure('  listBooks by recent', () => listBooks(db, ME, 'recent'), 15, 120);
    measure('  listBooks by title', () => listBooks(db, ME, 'title'));
    const all = listBooks(db, ME, 'recent');
    measure('  groupByProgress', () => groupByProgress(all));
    measure('  playlist counts', () => listPlaylistsWithCounts(db, ME), 15, 150);
    measure('  hidden count', () => hiddenCount(db, ME));
    measure('  music suggestions', () => musicSuggestions(db, ME), 15, 30);
    measure('  tags', () => listTags(db, ME));
  });

  it('Library refresh', () => {
    // A pause or a finished download changes one book (M126): the whole read against a reader
    // that rereads only the changed book, each followed by the sort the list draws from.
    let at = 1;
    const play = () => {
      at += 1;
      saveProgress(db, ME, {
        bookId: 'bench-book-5',
        fileLocation: 'bench-book-5-file-0',
        filePositionMs: at * 1000,
        savedAt: at,
      });
    };
    measure('Library refresh, whole read', () => {
      play();
      listBooksFrom(db, ME, listAllBooks(db, ME), 'recent');
    });
    const reader = libraryBooks(db);
    reader.read(ME);
    measure(
      'Library refresh, one book changed',
      () => {
        play();
        listBooksFrom(db, ME, reader.read(ME), 'recent');
      },
      15,
      40,
    );
    measure('  read of one changed book', () => {
      play();
      reader.read(ME);
    });
    measure('  saveProgress', play);
  });

  it('Home screen', () => {
    measure(
      'Home screen: continue, downloads',
      () => {
        continueListening(db, ME);
        listDownloads(db);
      },
      15,
      15,
    );
    measure('  continueListening', () => continueListening(db, ME));
  });

  it('Android Auto', () => {
    // Sent to the playback service whenever the library changes, at start several times.
    measure('carShelves', () => carShelves(db, ME), 5, 240);
  });

  it('Podcasts', () => {
    measure('Podcasts screen: 500 subscriptions', () => listSubscriptions(db, ME), 5, 60);
    measure('Podcast page: 40 episodes', () => listEpisodes(db, ME, 'bench-podcast-250'));
    measure('bookKey of an episode', () => bookKey(db, 'bench-episode-book-250-0'));
    measure('bookIdForKey of a book', () => bookIdForKey(db, 'bench:Author 5/missing'));
  });
});

describe('web database with 10,000 books', () => {
  // The web app keeps SQLite in sql.js and saves it as 256 KB chunks (`apps/app/src/db.web.ts`).
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  const source = createTestDb();
  seedBigLibrary(source, ME);
  const bytes = (
    source as unknown as { session: { client: { export(): Uint8Array } } }
  ).session.client.export();
  const files = new Map<string, Uint8Array>();
  const store: ChunkStore = {
    read: (name) => Promise.resolve(files.get(name) ?? null),
    write: (name, data) => {
      files.set(name, data.slice());
      return Promise.resolve();
    },
    remove: (name) => {
      files.delete(name);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...files.keys()]),
  };

  it('opens and saves', async () => {
    results.push({ what: 'database size', value: Math.round(bytes.length / 1e5) / 10, unit: 'MB' });
    const SQL = await initSqlJs();
    measure('web start: sql.js opens the file', () => new SQL.Database(bytes).close(), 7, 40);
    const sqlite = new SQL.Database(bytes);
    const database = drizzle(sqlite, { schema });
    measure(
      'web start: migrations, nothing to do',
      () => migrate(database, { migrationsFolder }),
      7,
      10,
    );

    await new ChunkedFile(store).save(bytes);
    const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
    // Freed buffers leave the count a moment after the collection.
    const collect = async () => {
      gc();
      await new Promise((resolve) => setTimeout(resolve, 100));
      gc();
    };
    await collect();
    const before = process.memoryUsage().arrayBuffers;
    const file = new ChunkedFile(store);
    const loaded = await file.load();
    await collect();
    const kept = process.memoryUsage().arrayBuffers - before - (loaded?.length ?? 0);
    // What the chunked file holds on to between saves, besides the database itself.
    results.push({
      what: 'web save: kept between saves',
      value: Math.round(kept / 1e5) / 10,
      unit: 'MB',
      budget: 5,
    });

    let n = 0;
    const changing = bytes.slice();
    await measureAsync(
      'web save after one change',
      () => {
        // A different place each time, so each save writes one chunk.
        const at = (n++ * 1_048_573) % changing.length;
        changing[at] = (changing[at] ?? 0) ^ 1;
        return file.save(changing);
      },
      15,
      80,
    );
    expect(await new ChunkedFile(store).load()).toEqual(changing);
  });
});

describe('folder scan of 10,000 books, 30,000 files', () => {
  const { rootLocation, files, listed, tags } = bigScan(10_000);
  let n = 0;
  const newId = () => `scan-${++n}`;
  const folder = { uri: 'content://big', name: 'Big', location: rootLocation };

  it('groups and scans', () => {
    measure('groupIntoBooks', () => groupIntoBooks(rootLocation, files, new Map()), 3, 250);
    measure(
      'first scan',
      () => {
        const fresh = createTestDb();
        const rootId = upsertRoot(fresh, folder, 1, newId);
        applyScan(fresh, {
          rootId,
          rootLocation,
          listed,
          tags,
          folderCovers: new Map(),
          now: 1,
          newId,
        });
      },
      3,
    );

    const db = createTestDb();
    const rootId = upsertRoot(db, folder, 1, newId);
    applyScan(db, { rootId, rootLocation, listed, tags, folderCovers: new Map(), now: 1, newId });
    measure(
      'rescan, nothing changed',
      () => {
        expect(filesNeedingTags(db, listed)).toEqual([]);
        applyScan(db, {
          rootId,
          rootLocation,
          listed,
          tags: new Map(),
          folderCovers: new Map(),
          now: 2,
          newId,
        });
      },
      3,
      1000,
    );
  });
});
