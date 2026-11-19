import type { SeriesList } from '@lelap/sdk';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { ROOT, scanned } from '../../test/files';
import type { Db } from '../db';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { books, type KindTags } from '../schema';
import { setFinished } from './queries';
import { applyScan, splitScanned, upsertRoot } from './scan';
import { getSeries, type Series, type SeriesBook, setSeriesOrder } from './series';
import {
  keepSeriesList,
  missingCount,
  nextInWholeSeries,
  type SeriesRow,
  seriesListDue,
  seriesRows,
  storedSeriesList,
  SERIES_LIST_MAX_AGE_MS,
} from './seriesList';

// Department Q as the Catalog's series resource lists it from Wikidata (M127), shortened.
const DEPARTMENT_Q: SeriesList = {
  name: 'Afdeling Q',
  id: 'wikidata:Q86567441',
  volumes: [
    {
      title: 'The Keeper of Lost Causes',
      titles: { en: 'The Keeper of Lost Causes', da: 'Kvinden i buret' },
      position: '1',
      released: '2007',
    },
    {
      title: 'The Absent One',
      titles: { en: 'The Absent One', da: 'Fasandræberne' },
      position: '2',
      released: '2008',
    },
    {
      title: 'A Conspiracy of Faith',
      titles: { en: 'A Conspiracy of Faith', da: 'Flaskepost fra P' },
      position: '3',
    },
    {
      title: 'The Purity of Vengeance',
      titles: { en: 'The Purity of Vengeance', da: 'Journal 64' },
      position: '4',
      released: '2010',
    },
  ],
};

const HARRY_POTTER: SeriesList = {
  name: 'Harry Potter',
  volumes: [
    { title: 'Harry Potter prequel', position: '0.5', released: '2008' },
    { title: "Harry Potter and the Philosopher's Stone", position: '1', released: '1997-06-26' },
    { title: 'Harry Potter and the Chamber of Secrets', position: '2', released: '1998' },
    { title: 'Harry Potter and the Cursed Child', released: '2016-07-31' },
  ],
};

let n = 0;
const entry = (title: string, number: number | null, finished = false): SeriesBook => ({
  book: {
    id: `b${++n}`,
    title,
    author: 'Jussi Adler-Olsen',
    coverPath: null,
    coverUrl: null,
    source: 'local',
    downloaded: false,
    durationMs: 1,
    bookPositionMs: 0,
    addedAt: 0,
    finishedAt: finished ? 1 : null,
    lastPlayedAt: null,
    missing: false,
  },
  bookKey: `key-${n}`,
  position: number === null ? null : String(number),
  number,
});

const seriesOf = (list: SeriesBook[], extra: Partial<Series> = {}): Series => ({
  key: 'afdeling q',
  keys: ['afdeling q'],
  name: 'Afdeling Q',
  author: 'Jussi Adler-Olsen',
  books: list,
  missing: [],
  ordered: false,
  held: [],
  ...extra,
});

const describeRow = (row: SeriesRow) =>
  row.kind === 'book'
    ? `have ${row.book.book.title}`
    : row.kind === 'volume'
      ? `lack ${row.number ?? '-'} ${row.title}${row.counted ? '' : ' (extra)'}`
      : `gap ${row.number}`;

describe('a whole series on its page', () => {
  it('lists every book in order, the missing ones by title in the library’s language', () => {
    const rows = seriesRows(
      seriesOf([entry('Kvinden i buret', 1), entry('Journal 64', 4)]),
      DEPARTMENT_Q,
    );
    expect(rows.map(describeRow)).toEqual([
      'have Kvinden i buret',
      'lack 2 Fasandræberne',
      'lack 3 Flaskepost fra P',
      'have Journal 64',
    ]);
    expect(missingCount(rows)).toBe(2);
    const second = rows[1];
    expect(second?.kind === 'volume' && second.year).toBe(2008);
  });

  it('matches a book without a number by its title, and keeps a book the list lacks', () => {
    const rows = seriesRows(
      seriesOf([entry('Fasandræberne', null), entry('Syv m2 med lås', 10)]),
      DEPARTMENT_Q,
    );
    expect(rows.map(describeRow)).toEqual([
      'lack 1 Kvinden i buret',
      'have Fasandræberne',
      'lack 3 Flaskepost fra P',
      'lack 4 Journal 64',
      'have Syv m2 med lås',
    ]);
  });

  it('trusts a whole title over a number that disagrees', () => {
    // Tagged #2, but it is book 3 by its title.
    const rows = seriesRows(seriesOf([entry('Flaskepost fra P', 2)]), DEPARTMENT_Q);
    expect(rows.map(describeRow)).toEqual([
      'lack 1 Kvinden i buret',
      'lack 2 Fasandræberne',
      'have Flaskepost fra P',
      'lack 4 Journal 64',
    ]);
  });

  it('does not call a second work at the same number missing', () => {
    const list: SeriesList = {
      ...DEPARTMENT_Q,
      volumes: [...DEPARTMENT_Q.volumes, { title: 'A novella', position: '2' }],
    };
    const rows = seriesRows(seriesOf([entry('Fasandræberne', 2)]), list);
    expect(rows.map(describeRow)).not.toContain('lack 2 A novella');
  });

  it('shows the prequel and the play in place, never as missing', () => {
    const rows = seriesRows(
      seriesOf([entry("Harry Potter and the Philosopher's Stone", 1)]),
      HARRY_POTTER,
    );
    expect(rows.map(describeRow)).toEqual([
      'lack 0.5 Harry Potter prequel (extra)',
      "have Harry Potter and the Philosopher's Stone",
      'lack 2 Harry Potter and the Chamber of Secrets',
      'lack - Harry Potter and the Cursed Child (extra)',
    ]);
    expect(missingCount(rows)).toBe(1);
  });

  it('keeps the listener’s own order, the books they lack after theirs', () => {
    const rows = seriesRows(
      seriesOf([entry('Journal 64', 4), entry('Kvinden i buret', 1)], { ordered: true }),
      DEPARTMENT_Q,
    );
    expect(rows.map(describeRow)).toEqual([
      'have Journal 64',
      'have Kvinden i buret',
      'lack 2 Fasandræberne',
      'lack 3 Flaskepost fra P',
    ]);
  });

  it('leaves out a number a hidden book holds', () => {
    const rows = seriesRows(seriesOf([entry('Kvinden i buret', 1)], { held: [2] }), DEPARTMENT_Q);
    expect(rows.map(describeRow)).not.toContain('lack 2 Fasandræberne');
  });

  it('shows gaps as before without a list', () => {
    const rows = seriesRows(
      seriesOf([entry('Kvinden i buret', 1), entry('Journal 64', 4)], { missing: [2, 3] }),
      null,
    );
    expect(rows.map(describeRow)).toEqual([
      'have Kvinden i buret',
      'gap 2',
      'gap 3',
      'have Journal 64',
    ]);
    expect(missingCount(rows)).toBe(2);
  });
});

describe('the kept list', () => {
  it('keeps one answer per series and language, asked again when old', () => {
    const db = createTestDb();
    expect(storedSeriesList(db, 'afdeling q', 'en')).toBeNull();
    expect(seriesListDue(null, 0)).toBe(true);
    keepSeriesList(db, 'afdeling q', 'en', DEPARTMENT_Q, 1000);
    keepSeriesList(db, 'afdeling q', 'ms', null, 1000);
    const kept = storedSeriesList(db, 'afdeling q', 'en');
    expect(kept?.list?.volumes).toHaveLength(4);
    expect(seriesListDue(kept, 1000 + SERIES_LIST_MAX_AGE_MS - 1)).toBe(false);
    expect(seriesListDue(kept, 1000 + SERIES_LIST_MAX_AGE_MS + 1)).toBe(true);
    // A series no add-on knew is asked again sooner.
    expect(seriesListDue(storedSeriesList(db, 'afdeling q', 'ms'), 1000 + 4 * 86_400_000)).toBe(
      true,
    );
    keepSeriesList(db, 'afdeling q', 'en', null, 2000);
    expect(storedSeriesList(db, 'afdeling q', 'en')).toEqual({ list: null, fetchedAt: 2000 });
  });
});

const tags = (series: string): KindTags => ({
  genre: null,
  isrc: null,
  track: null,
  year: null,
  narrator: null,
  mediaKind: 'audiobook',
  series,
});

function library(db: Db) {
  let id = 0;
  const newId = () => `id-${String(++id).padStart(6, '0')}`;
  const rootId = upsertRoot(
    db,
    { uri: `content://${ROOT}`, name: 'Audiobooks', location: ROOT },
    1,
    newId,
  );
  const { listed, tags: read } = splitScanned([
    scanned('Q1/book.m4b', {
      album: 'Kvinden i buret',
      albumArtist: 'Jussi Adler-Olsen',
      kindTags: tags('Afdeling Q #1'),
    }),
    scanned('Q4/book.m4b', {
      album: 'Journal 64',
      albumArtist: 'Jussi Adler-Olsen',
      kindTags: tags('Afdeling Q #4'),
    }),
  ]);
  applyScan(db, {
    rootId,
    rootLocation: ROOT,
    listed,
    tags: read,
    folderCovers: new Map(),
    now: 1,
    newId,
  });
  const idOf = (folder: string) =>
    db
      .select({ id: books.id })
      .from(books)
      .where(eq(books.location, `${ROOT}/${folder}`))
      .get()?.id ?? '';
  return { first: idOf('Q1'), fourth: idOf('Q4') };
}

describe('next in the whole series', () => {
  it('names the next book by its title when the library lacks it', () => {
    const db = createTestDb();
    const { first } = library(db);
    // Without a list, the next number, as M109 does it.
    expect(nextInWholeSeries(db, ME, first, 'en')).toMatchObject({ book: null, number: 2 });
    expect(nextInWholeSeries(db, ME, first, 'en')?.title).toBeUndefined();
    keepSeriesList(db, 'afdeling q', 'en', DEPARTMENT_Q, 1);
    expect(nextInWholeSeries(db, ME, first, 'en')).toMatchObject({
      book: null,
      number: 2,
      position: '2',
      title: 'Fasandræberne',
      year: 2008,
    });
  });

  it('plays the next book the library has, past the finished ones', () => {
    const db = createTestDb();
    const { first, fourth } = library(db);
    const list = {
      ...DEPARTMENT_Q,
      volumes: DEPARTMENT_Q.volumes.filter((v) => v.position === '1' || v.position === '4'),
    };
    keepSeriesList(db, 'afdeling q', 'en', list, 1);
    expect(nextInWholeSeries(db, ME, first, 'en')?.book?.id).toBe(fourth);
    setFinished(db, ME, fourth, true, 2);
    expect(nextInWholeSeries(db, ME, first, 'en')).toBeNull();
  });

  it('follows the listener’s own order', () => {
    const db = createTestDb();
    const { first, fourth } = library(db);
    keepSeriesList(db, 'afdeling q', 'en', DEPARTMENT_Q, 1);
    const keys = getSeries(db, ME, 'afdeling q')?.books.map((b) => b.bookKey) ?? [];
    setSeriesOrder(db, ME, 'afdeling q', [...keys].reverse(), 2);
    expect(nextInWholeSeries(db, ME, fourth, 'en')?.book?.id).toBe(first);
  });
});
