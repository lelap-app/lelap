import {
  orderSeriesVolumes,
  positionNumber,
  type SeriesList,
  type SeriesListVolume,
  titleKey,
} from '@lelap/sdk';
import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { seriesLists } from '../schema';
import {
  compareInSeries,
  mainSeriesOf,
  type NextInSeries,
  nextInSeries,
  type Series,
  type SeriesBook,
} from './series';

// The whole series (M127): what an add-on's `series` resource listed, kept on the device, and
// merged with the books the library has. Pure apart from the two functions that read and keep it.

/** Asked again after this long; a series that no add-on knew, sooner. */
export const SERIES_LIST_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SERIES_LIST_UNKNOWN_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export type StoredSeriesList = { list: SeriesList | null; fetchedAt: number };

/** The last answer for a series in this language, or null when it was never asked. */
export function storedSeriesList(db: Db, key: string, language: string): StoredSeriesList | null {
  const row = db
    .select({ list: seriesLists.list, fetchedAt: seriesLists.fetchedAt })
    .from(seriesLists)
    .where(and(eq(seriesLists.key, key), eq(seriesLists.language, language)))
    .get();
  return row ? { list: row.list ?? null, fetchedAt: row.fetchedAt } : null;
}

export function keepSeriesList(
  db: Db,
  key: string,
  language: string,
  list: SeriesList | null,
  now: number,
): void {
  db.insert(seriesLists)
    .values({ key, language, list, fetchedAt: now })
    .onConflictDoUpdate({
      target: [seriesLists.key, seriesLists.language],
      set: { list, fetchedAt: now },
    })
    .run();
}

/** Whether to ask the add-ons again: never asked, or the answer is old. */
export function seriesListDue(stored: StoredSeriesList | null, now: number): boolean {
  if (!stored) return true;
  const age = now - stored.fetchedAt;
  return age < 0 || age > (stored.list ? SERIES_LIST_MAX_AGE_MS : SERIES_LIST_UNKNOWN_AGE_MS);
}

/** One place on a series page. */
export type SeriesRow =
  /** A book the library has; `volume` is the listed book it is, when the list has it. */
  | { kind: 'book'; book: SeriesBook; volume: SeriesListVolume | null }
  /**
   * A listed book the library lacks. `counted` when its number is whole: half numbers and books
   * without a number (short stories, companions) are shown but never called missing.
   */
  | {
      kind: 'volume';
      volume: SeriesListVolume;
      title: string;
      number: number | null;
      year: number | null;
      counted: boolean;
    }
  /** A whole number no book has, worked out from the library alone (M109), without a list. */
  | { kind: 'gap'; number: number };

const keys = (title: string) => {
  const key = titleKey(title);
  return [key.full, key.main].filter((k) => k.length >= 2);
};

/** Every title a listed book goes by, folded. */
const volumeKeys = (volume: SeriesListVolume) =>
  new Set([volume.title, ...Object.values(volume.titles ?? {})].flatMap(keys));

/**
 * The language of the books the library has, as the list writes their titles, such as `da` for
 * Danish editions; null when no title says.
 */
export function libraryLanguage(
  matched: readonly { book: SeriesBook; volume: SeriesListVolume }[],
): string | null {
  const counts = new Map<string, number>();
  for (const { book, volume } of matched) {
    const own = new Set(keys(book.book.title));
    for (const [lang, title] of Object.entries(volume.titles ?? {})) {
      if (keys(title).some((k) => own.has(k))) counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  for (const [lang, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = lang;
  return best;
}

const yearOf = (released: string | undefined) => {
  const year = released ? Number(released.slice(0, 4)) : NaN;
  return Number.isFinite(year) ? year : null;
};

const rowNumber = (row: SeriesRow): number | null =>
  row.kind === 'book'
    ? (row.book.number ?? positionNumber(row.volume?.position))
    : row.kind === 'volume'
      ? row.number
      : row.number;

/** Gaps go where their number belongs; in the listener's own order they follow the books. */
function gapRows(series: Series): SeriesRow[] {
  const books = series.books.map((book): SeriesRow => ({ kind: 'book', book, volume: null }));
  const gaps = series.missing.map((number): SeriesRow => ({ kind: 'gap', number }));
  if (series.ordered) return [...books, ...gaps];
  return insertByNumber(books, gaps);
}

/** Puts `extra` rows into `rows` before the first row with a higher number; unnumbered last. */
function insertByNumber(rows: SeriesRow[], extra: SeriesRow[]): SeriesRow[] {
  const out = [...rows];
  for (const row of extra) {
    const number = rowNumber(row);
    const at =
      number === null
        ? -1
        : out.findIndex((r) => {
            const n = rowNumber(r);
            return n !== null && n > number;
          });
    if (at < 0) out.push(row);
    else out.splice(at, 0, row);
  }
  return out;
}

/**
 * The series page's rows: with a list, every listed book in its order, the library's books in
 * their places and the others by title; without one, the library's books and gaps (M109). The
 * listener's own order still wins: their books first as they put them, then the listed books
 * they lack. Books the profile hid only hold their number.
 */
export function seriesRows(series: Series, list: SeriesList | null): SeriesRow[] {
  if (!list || list.volumes.length === 0) return gapRows(series);
  const volumes = orderSeriesVolumes(list.volumes);
  const numbers = volumes.map((v) => positionNumber(v.position));
  const taken = new Set<number>();
  const matchOf = new Map<SeriesBook, number>();
  // The whole title first: tags and Wikidata may number a book differently (a prequel as 0 or
  // 0.5), and a title says which book it is. Then by number, then by a title without subtitle.
  const full = volumes.map(
    (v) => new Set([v.title, ...Object.values(v.titles ?? {})].map((t) => titleKey(t).full)),
  );
  for (const book of series.books) {
    const own = titleKey(book.book.title).full;
    if (own.length < 2) continue;
    const at = full.findIndex((k, i) => !taken.has(i) && k.has(own));
    if (at >= 0) {
      taken.add(at);
      matchOf.set(book, at);
    }
  }
  for (const book of series.books) {
    if (book.number === null || matchOf.has(book)) continue;
    const at = numbers.findIndex((n, i) => n === book.number && !taken.has(i));
    if (at >= 0) {
      taken.add(at);
      matchOf.set(book, at);
    }
  }
  const titled = volumes.map(volumeKeys);
  for (const book of series.books) {
    if (matchOf.has(book)) continue;
    const own = keys(book.book.title);
    const at = titled.findIndex(
      (k, i) =>
        !taken.has(i) &&
        // A book whose number disagrees is another book of the same name.
        (book.number === null || numbers[i] === null || numbers[i] === book.number) &&
        own.some((key) => k.has(key)),
    );
    if (at >= 0) {
      taken.add(at);
      matchOf.set(book, at);
    }
  }
  const matched = [...matchOf].map(([book, at]) => ({
    book,
    volume: volumes[at] as SeriesListVolume,
  }));
  const language = libraryLanguage(matched);
  const held = new Set(series.held);
  const lacking = (i: number): SeriesRow | null => {
    const volume = volumes[i];
    const number = numbers[i] ?? null;
    if (!volume || taken.has(i) || (number !== null && held.has(number))) return null;
    // Two works at one number (a novel and its novella): the one the library has stands for both.
    if (number !== null && numbers.some((n, j) => n === number && taken.has(j))) return null;
    return {
      kind: 'volume',
      volume,
      title: (language ? volume.titles?.[language] : undefined) ?? volume.title,
      number,
      year: yearOf(volume.released),
      counted: number !== null && Number.isInteger(number),
    };
  };
  const bookRow = (book: SeriesBook): SeriesRow => {
    const at = matchOf.get(book);
    return { kind: 'book', book, volume: at === undefined ? null : (volumes[at] ?? null) };
  };

  if (series.ordered) {
    const rest = volumes.map((_, i) => lacking(i)).filter((r): r is SeriesRow => r !== null);
    return [...series.books.map(bookRow), ...rest];
  }
  const byVolume = new Map([...matchOf].map(([book, at]) => [at, book]));
  const rows: SeriesRow[] = [];
  volumes.forEach((_, i) => {
    const book = byVolume.get(i);
    const row = book ? bookRow(book) : lacking(i);
    if (row) rows.push(row);
  });
  const unlisted = series.books.filter((b) => !matchOf.has(b)).sort(compareInSeries);
  return insertByNumber(rows, unlisted.map(bookRow));
}

/**
 * Next in the series with the whole list kept for this language: the next listed book after
 * this one, played when the library has it (and it isn't finished), else named by its title to
 * look for. Half numbers and books without one are passed over. Without a list, or in the
 * listener's own order, as M109 does it.
 */
export function nextInWholeSeries(
  db: Db,
  profileId: string,
  bookId: string,
  language: string,
  version?: number,
): NextInSeries | null {
  const series = mainSeriesOf(db, profileId, bookId, version);
  const list = series ? storedSeriesList(db, series.key, language)?.list : null;
  if (!series || !list || series.ordered) return nextInSeries(db, profileId, bookId, version);
  const rows = seriesRows(series, list);
  const at = rows.findIndex((r) => r.kind === 'book' && r.book.book.id === bookId);
  if (at < 0) return nextInSeries(db, profileId, bookId, version);
  const head = { key: series.key, name: series.name, author: series.author };
  for (const row of rows.slice(at + 1)) {
    if (row.kind === 'volume') {
      if (!row.counted) continue;
      return {
        series: head,
        book: null,
        position: row.volume.position ?? null,
        number: row.number,
        title: row.title,
        ...(row.year !== null ? { year: row.year } : {}),
      };
    }
    if (row.kind === 'book' && row.book.book.finishedAt === null && !row.book.book.missing) {
      return {
        series: head,
        book: row.book.book,
        position: row.book.position,
        number: row.book.number,
      };
    }
  }
  return null;
}

/** How many listed books with a whole number, or gaps, the library lacks. */
export function missingCount(rows: readonly SeriesRow[]): number {
  return rows.filter((r) => r.kind === 'gap' || (r.kind === 'volume' && r.counted)).length;
}
