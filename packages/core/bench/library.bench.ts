import { afterAll, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { bigScan } from '../test/bigScan';
import { seedBigLibrary } from '../src/bigLibrary';
import { carShelves } from '../src/car';
import { listDownloads } from '../src/downloads';
import { groupByProgress } from '../src/library/byProgress';
import { continueListening, listBooks } from '../src/library/queries';
import { groupIntoBooks } from '../src/library/group';
import { applyScan, filesNeedingTags, upsertRoot } from '../src/library/scan';
import { listPlaylistsWithCounts, listTags } from '../src/organise';
import { listEpisodes, listSubscriptions } from '../src/podcasts/repository';
import { DEFAULT_PROFILE_ID as ME } from '../src/profiles';
import { bookIdForKey, bookKey } from '../src/sync/keys';

// What the Library, Home and Podcasts screens and the folder scan cost with M43's 10,000 books
// and 500 podcasts. `pnpm --filter @lelap/core bench`; before and after: docs/milestones/m43.md.

const results: { what: string; 'median ms': number; runs: number }[] = [];

function measure(what: string, run: () => unknown, runs = 15): void {
  run();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  results.push({ what, 'median ms': Math.round(median * 10) / 10, runs });
}

afterAll(() => {
  const lines = results.map((r) => `${r.what.padEnd(48)} ${String(r['median ms']).padStart(9)} ms`);
  process.stdout.write(`\nMedian time per run:\n${lines.join('\n')}\n\n`);
});

describe('10,000 books, 500 podcasts', () => {
  const db = createTestDb();
  seedBigLibrary(db, ME);

  it('Library screen', () => {
    measure('Library screen: books, continue, lists, tags', () => {
      groupByProgress(listBooks(db, ME, 'recent'));
      continueListening(db, ME);
      listPlaylistsWithCounts(db, ME);
      listTags(db, ME);
    });
    measure('  listBooks by recent', () => listBooks(db, ME, 'recent'));
    measure('  listBooks by title', () => listBooks(db, ME, 'title'));
    const all = listBooks(db, ME, 'recent');
    measure('  groupByProgress', () => groupByProgress(all));
    measure('  playlist counts', () => listPlaylistsWithCounts(db, ME));
  });

  it('Home screen', () => {
    measure('Home screen: continue, downloads', () => {
      continueListening(db, ME);
      listDownloads(db);
    });
    measure('  continueListening', () => continueListening(db, ME));
  });

  it('Android Auto', () => {
    // Sent to the playback service whenever the library changes, at start several times.
    measure('carShelves', () => carShelves(db, ME), 5);
  });

  it('Podcasts', () => {
    measure('Podcasts screen: 500 subscriptions', () => listSubscriptions(db, ME), 5);
    measure('Podcast page: 40 episodes', () => listEpisodes(db, ME, 'bench-podcast-250'));
    measure('bookKey of an episode', () => bookKey(db, 'bench-episode-book-250-0'));
    measure('bookIdForKey of a book', () => bookIdForKey(db, 'bench:Author 5/missing'));
  });
});

describe('folder scan of 10,000 books, 30,000 files', () => {
  const { rootLocation, files, listed, tags } = bigScan(10_000);
  let n = 0;
  const newId = () => `scan-${++n}`;
  const folder = { uri: 'content://big', name: 'Big', location: rootLocation };

  it('groups and scans', () => {
    measure('groupIntoBooks', () => groupIntoBooks(rootLocation, files, new Map()), 3);
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
    );
  });
});
