import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBigLibrary } from '../src/bigLibrary';
import { getSeries, listSeries, nextInSeries } from '../src/library/series';
import { DEFAULT_PROFILE_ID as ME } from '../src/profiles';
import { bookFiles } from '../src/schema';

// What series cost in M43's 10,000 books when a third of them name one (M115): worked out each
// time, and kept for one library version. `pnpm --filter @lelap/core bench`. Budgets as in
// library.bench.ts (M106): about three times the median in docs/milestones/m115.md.

const results: { what: string; median: number; budget?: number | undefined }[] = [];

function measure(what: string, run: () => unknown, runs = 15, budget?: number): void {
  run();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  results.push({
    what,
    median: Math.round((times[Math.floor(times.length / 2)] ?? 0) * 100) / 100,
    budget,
  });
}

afterAll(() => {
  const over = (r: (typeof results)[number]) => r.budget !== undefined && r.median > r.budget;
  const lines = results.map((r) => {
    const budget =
      r.budget === undefined ? '' : `  budget ${r.budget} ms${over(r) ? '  OVER' : ''}`;
    return `${r.what.padEnd(48)} ${String(r.median).padStart(9)} ms${budget}`;
  });
  process.stdout.write(`\nMedian per run:\n${lines.join('\n')}\n\n`);
  expect(
    results.filter(over).map((r) => r.what),
    'over budget',
  ).toEqual([]);
});

describe('series in 10,000 books', () => {
  const db = createTestDb();
  seedBigLibrary(db, ME);
  // Every third book is in a series of its author's, numbered as it comes.
  db.transaction((tx) => {
    for (let n = 0; n < 10_000; n += 3) {
      tx.update(bookFiles)
        .set({
          kindTags: {
            genre: null,
            isrc: null,
            track: null,
            year: null,
            narrator: null,
            mediaKind: 'audiobook',
            series: `Saga of Author ${n % 1_200} #${Math.floor(n / 1_200) + 1}`,
          },
        })
        .where(eq(bookFiles.id, `bench-book-${n}-file-0`))
        .run();
    }
  });

  it('Series view, series page, next in the series', () => {
    expect(listSeries(db, ME).length).toBe(400);
    const key = listSeries(db, ME)[0]?.key ?? '';
    measure('listSeries, worked out', () => listSeries(db, ME), 5, 400);
    measure('getSeries, worked out', () => getSeries(db, ME, key), 5);
    measure('nextInSeries, worked out', () => nextInSeries(db, ME, 'bench-book-0'), 5);
    let version = 0;
    measure('listSeries, new library version each time', () => listSeries(db, ME, ++version), 5);
    measure('listSeries, same library version', () => listSeries(db, ME, version), 15, 1);
    measure('getSeries, same library version', () => getSeries(db, ME, key, version));
    measure(
      'nextInSeries, same library version',
      () => nextInSeries(db, ME, 'bench-book-0', version),
      15,
      1,
    );
  });
});
