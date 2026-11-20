import { createWorkIndex, matchStrength, splitAuthors } from '@lelap/sdk';
import { and, desc, eq, isNotNull, isNull, like, ne } from 'drizzle-orm';

import type { Db } from '../db';
import { bookFiles, books, settings } from '../schema';
import { compareNatural } from './files';
import { linkedSeriesByKey } from './links';
import { type LibraryBook, listBooks } from './queries';
import { parseSeries, seriesKey, seriesNumber } from './seriesNames';

export * from './seriesNames';

// Series (M109): which library books belong together, in what order, and which numbers are
// missing. Worked out on this device from what tags, servers and add-ons already said; nothing
// here asks the network.

/** A book in a series, with where the series puts it. */
export type SeriesBook = {
  book: LibraryBook;
  /** The book's synced name, which the listener's own order is kept by. */
  bookKey: string;
  position: string | null;
  number: number | null;
};

export type Series = {
  /** The key of its name; the listener's order is kept by it. */
  key: string;
  /**
   * The keys of every name its books use, `key` among them. The series page and an order from
   * another device find it by any of them, so a new spelling never loses it.
   */
  keys: string[];
  name: string;
  /** The author most of its books name. */
  author: string | null;
  /** In reading order: the listener's own, else by number. */
  books: SeriesBook[];
  /** Whole numbers from 1 to the highest that no book in the library has. */
  missing: number[];
  /** The listener put the books in an order of their own. */
  ordered: boolean;
  /** Numbers that books the profile hid hold (M115): not missing, and nothing to look for. */
  held: number[];
  /** Titles of the books the profile hid, so a whole series list knows them by title too. */
  heldTitles: string[];
};

/** Gaps are only shown up to this number, so a year or a catalogue number reads as no gap. */
const MAX_GAP_NUMBER = 100;
const ORDER_PREFIX = 'seriesOrder:';

/** `hidden`: the profile hid the book; it counts for the gaps but is not listed (M115). */
type Member = SeriesBook & { name: string; nameKey: string; rank: number; hidden: boolean };

/** Every series a library book names, from its files' tags or its linked catalog work. */
function members(db: Db, profileId: string): Member[] {
  const visible = listBooks(db, profileId, 'title');
  if (visible.length === 0) return [];
  const hidden = new Set<string>();
  const shelf = [...visible];
  for (const book of listBooks(db, profileId, 'title', 'hidden')) {
    hidden.add(book.id);
    shelf.push(book);
  }
  const locations = new Map(
    db
      .select({ id: books.id, location: books.location })
      .from(books)
      .where(ne(books.source, 'feed'))
      .all()
      .map((b) => [b.id, b.location]),
  );
  // The first file that says, per book; only files whose tags name a series are read.
  const tagged = new Map<string, string>();
  for (const f of db
    .select({ bookId: bookFiles.bookId, kindTags: bookFiles.kindTags })
    .from(bookFiles)
    .where(
      and(
        isNotNull(bookFiles.bookId),
        isNull(bookFiles.missingSince),
        like(bookFiles.kindTags, '%"series":"%'),
      ),
    )
    .orderBy(bookFiles.idx)
    .all()) {
    const series = f.kindTags?.series?.trim();
    if (f.bookId && series && !tagged.has(f.bookId)) tagged.set(f.bookId, series);
  }
  const linked = linkedSeriesByKey(db);

  const out: Member[] = [];
  for (const book of shelf) {
    const bookKey = locations.get(book.id);
    if (!bookKey) continue;
    // A work the listener matched or confirmed knows its series better than the files do.
    const text = linked.get(bookKey) ?? tagged.get(book.id);
    parseSeries(text).forEach((ref, rank) => {
      const nameKey = seriesKey(ref.name);
      if (!nameKey) return;
      out.push({
        book,
        bookKey,
        name: ref.name,
        nameKey,
        rank,
        hidden: hidden.has(book.id),
        position: ref.position,
        number: seriesNumber(ref.position),
      });
    });
  }
  return out;
}

/** Union-find over name keys, so two names for one series end up as one. */
function joiner() {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const up = parent.get(key) ?? key;
    if (up === key) return key;
    const root = find(up);
    parent.set(key, root);
    return root;
  };
  const join = (a: string, b: string) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent.set(right < left ? left : right, right < left ? right : left);
  };
  return { find, join };
}

const mostCommon = (values: (string | null)[]): string | null => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, n] of counts) {
    const most = best === null ? 0 : (counts.get(best) ?? 0);
    // On a tie the shorter one: “The Expanse” rather than “The Expanse Series”.
    if (best === null || n > most || (n === most && v.length < best.length)) best = v;
  }
  return best;
};

/** By number, books without one after the numbered ones; then by title. */
export function compareInSeries(
  a: { number: number | null; book: { title: string } },
  b: { number: number | null; book: { title: string } },
): number {
  if (a.number !== null && b.number !== null && a.number !== b.number) return a.number - b.number;
  if (a.number === null && b.number !== null) return 1;
  if (a.number !== null && b.number === null) return -1;
  return compareNatural(a.book.title, b.book.title);
}

/** Whole numbers from 1 up to the highest a book has, that no book has. */
export function missingNumbers(numbers: readonly (number | null)[]): number[] {
  const whole = new Set(numbers.filter((n): n is number => n !== null && Number.isInteger(n)));
  const highest = Math.max(0, ...whole);
  if (highest > MAX_GAP_NUMBER) return [];
  const missing: number[] = [];
  for (let n = 1; n < highest; n++) if (!whole.has(n)) missing.push(n);
  return missing;
}

/** Puts books in the listener's order; books it doesn't name follow in the usual order. */
export function applyOrder(list: readonly SeriesBook[], order: readonly string[]): SeriesBook[] {
  const at = new Map(order.map((key, i) => [key, i]));
  const named = list.filter((b) => at.has(b.bookKey));
  named.sort((a, b) => (at.get(a.bookKey) ?? 0) - (at.get(b.bookKey) ?? 0));
  return [...named, ...list.filter((b) => !at.has(b.bookKey))];
}

/** The listener's own order of a series, as book keys; empty for the usual order. */
export function getSeriesOrder(db: Db, profileId: string, key: string): string[] {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.profileId, profileId), eq(settings.key, `${ORDER_PREFIX}${key}`)))
    .get();
  return row ? cleanOrder(row.value) : [];
}

/** Every order the profile keeps, newest first, read at once. */
function allOrders(db: Db, profileId: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const row of db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(eq(settings.profileId, profileId), like(settings.key, `${ORDER_PREFIX}%`)))
    .orderBy(desc(settings.updatedAt))
    .all()) {
    out.set(row.key.slice(ORDER_PREFIX.length), cleanOrder(row.value));
  }
  return out;
}

/** A stored or received order, checked: it is only data. */
export function cleanOrder(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 2048)
    .slice(0, 1000);
}

/** Keeps the listener's order of a series; an empty list goes back to the usual order. */
export function setSeriesOrder(
  db: Db,
  profileId: string,
  key: string,
  order: readonly string[],
  now: number,
): void {
  const value = JSON.stringify(cleanOrder([...order]));
  db.insert(settings)
    .values({ profileId, key: `${ORDER_PREFIX}${key}`, value, updatedAt: now })
    .onConflictDoUpdate({
      target: [settings.profileId, settings.key],
      set: { value, updatedAt: now },
    })
    .run();
}

export const SERIES_ORDER_PREFIX = ORDER_PREFIX;

/**
 * Every series in the library, by name. Names that fold to the same key are one series, and so
 * are two names whose books are the same work at the same number, by the SDK's work matcher (a
 * catalog's “The Expanse” and a server's “Expanse”). The same work twice in one series (a server's
 * copy and a streamed one) is listed once, the copy played last or else the listener's own file.
 */
export function listSeries(db: Db, profileId: string, version?: number): Series[] {
  return built(db, profileId, version).series;
}

type Built = {
  series: Series[];
  all: Member[];
  /** Numbers that hidden books hold, by series key: no gap, and nothing to look for. */
  held: Map<string, Set<number>>;
};

const cache = new WeakMap<Db, { profileId: string; version: number; built: Built }>();

/**
 * Working out every series reads the whole library, and the Library, a series page and an item
 * page each ask (M115). With the library's version, the result is kept until it changes.
 */
function built(db: Db, profileId: string, version: number | undefined): Built {
  if (version === undefined) return build(db, profileId);
  const kept = cache.get(db);
  if (kept && kept.profileId === profileId && kept.version === version) return kept.built;
  const fresh = build(db, profileId);
  cache.set(db, { profileId, version, built: fresh });
  return fresh;
}

function build(db: Db, profileId: string): Built {
  const all = members(db, profileId);
  const held = new Map<string, Set<number>>();
  if (all.length === 0) return { series: [], all, held };
  // The names each book gives, so a book's own two series are never joined through its twin.
  const named = new Map<string, Set<string>>();
  for (const m of all) {
    const keys = named.get(m.book.id) ?? new Set<string>();
    keys.add(m.nameKey);
    named.set(m.book.id, keys);
  }

  const { find, join } = joiner();
  // Hidden books only fill gaps: a mis-tagged copy the listener hid joins no two series.
  const shown = all.filter((m) => !m.hidden);
  const index = createWorkIndex(
    shown.map((m) => ({
      item: m,
      title: m.book.title,
      authors: splitAuthors(m.book.author),
      series: m.number,
    })),
  );
  for (const m of shown) {
    if (m.number === null) continue;
    for (const { item } of index.find({
      title: m.book.title,
      authors: splitAuthors(m.book.author),
      series: m.number,
    })) {
      if (item.book.id === m.book.id || item.number !== m.number) continue;
      if (named.get(m.book.id)?.has(item.nameKey) || named.get(item.book.id)?.has(m.nameKey)) {
        continue;
      }
      join(m.nameKey, item.nameKey);
    }
  }

  const groups = new Map<string, Member[]>();
  for (const m of all) {
    const root = find(m.nameKey);
    const list = groups.get(root);
    if (list) list.push(m);
    else groups.set(root, [m]);
  }

  const orders = allOrders(db, profileId);
  const out: Series[] = [];
  for (const group of groups.values()) {
    const list = group.filter((m) => !m.hidden);
    if (list.length === 0) continue;
    // The name most books use is the series' name; its key keeps the page and the order.
    const name = mostCommon(list.map((m) => m.name)) ?? list[0]?.name ?? '';
    const key = seriesKey(name);
    const preferred = (a: Member, b: Member) =>
      (b.book.lastPlayedAt ?? -1) - (a.book.lastPlayedAt ?? -1) ||
      Number(b.book.source === 'local') - Number(a.book.source === 'local');
    const kept: Member[] = [];
    for (const m of [...list].sort(preferred)) {
      if (kept.some((k) => k.book.id === m.book.id)) continue;
      const twin =
        m.number !== null &&
        kept.some(
          (k) =>
            k.number === m.number &&
            matchStrength(
              { title: k.book.title, authors: splitAuthors(k.book.author) },
              { title: m.book.title, authors: splitAuthors(m.book.author) },
            ) !== null,
        );
      if (!twin) kept.push(m);
    }
    const usual = kept
      .map(({ book, bookKey, position, number }) => ({ book, bookKey, position, number }))
      .sort(compareInSeries);
    const keys = [...new Set([key, ...group.map((m) => m.nameKey)])];
    const hiddenNumbers = new Set(
      group.filter((m) => m.hidden && m.number !== null).map((m) => m.number as number),
    );
    if (hiddenNumbers.size > 0) held.set(key, hiddenNumbers);
    // The newest order kept under any of its names; an empty one is the usual order.
    const order = [...orders].find(([k]) => keys.includes(k))?.[1] ?? [];
    out.push({
      key,
      keys,
      name,
      author: mostCommon(usual.map((b) => splitAuthors(b.book.author)[0] ?? null)),
      books: order.length > 0 ? applyOrder(usual, order) : usual,
      // Up to the highest number listed, as before: a hidden book only fills a gap.
      missing: missingNumbers(usual.map((b) => b.number)).filter((n) => !hiddenNumbers.has(n)),
      ordered: order.length > 0,
      held: [...hiddenNumbers].sort((a, b) => a - b),
      heldTitles: [...new Set(group.filter((m) => m.hidden).map((m) => m.book.title))],
    });
  }
  return { series: out.sort((a, b) => compareNatural(a.name, b.name)), all, held };
}

/**
 * One series by the key of any of its names, or null when no book in the library names it.
 * `version` is the library's, for the kept result.
 */
export function getSeries(db: Db, profileId: string, key: string, version?: number): Series | null {
  const series = listSeries(db, profileId, version);
  return series.find((s) => s.key === key) ?? series.find((s) => s.keys.includes(key)) ?? null;
}

/** The series in the library a name means, such as a catalog work's. */
export function findSeries(
  db: Db,
  profileId: string,
  name: string,
  version?: number,
): Series | null {
  return getSeries(db, profileId, seriesKey(name), version);
}

/** The series a book is in, its main series first. */
export function seriesOfBook(
  db: Db,
  profileId: string,
  bookId: string,
  version?: number,
): Series[] {
  return listSeries(db, profileId, version)
    .filter((s) => s.books.some((b) => b.book.id === bookId))
    .sort((a, b) => Number(b.books.length) - Number(a.books.length));
}

/** Moves a book to `to` in a series, which from then on keeps the listener's order. */
export function moveInSeries(
  db: Db,
  profileId: string,
  key: string,
  bookId: string,
  to: number,
  now: number,
): void {
  const series = getSeries(db, profileId, key);
  if (!series) return;
  const keys = series.books.map((b) => b.bookKey);
  const from = series.books.findIndex((b) => b.book.id === bookId);
  if (from < 0 || to < 0 || to >= keys.length || from === to) return;
  const [moved] = keys.splice(from, 1);
  if (moved === undefined) return;
  keys.splice(to, 0, moved);
  setSeriesOrder(db, profileId, key, keys, now);
}

/**
 * What to offer when a book ends: the next book of its series in the library, or the next
 * number when the library doesn't have it (`book` null), for the listener to look for in the
 * catalogs.
 */
export type NextInSeries = {
  series: Pick<Series, 'key' | 'name' | 'author'>;
  book: LibraryBook | null;
  position: string | null;
  number: number | null;
  /** The missing book's title and year, when a whole series list names it (M127). */
  title?: string;
  year?: number;
};

/** The series a book names first, its main series; null when it is in none. */
export function mainSeriesOf(
  db: Db,
  profileId: string,
  bookId: string,
  version?: number,
): Series | null {
  const { all, series: list } = built(db, profileId, version);
  const own = all.filter((m) => m.book.id === bookId);
  const rank = (s: Series) =>
    Math.min(...own.filter((m) => s.keys.includes(m.nameKey)).map((m) => m.rank), 99);
  const ranked = list
    .filter((s) => s.books.some((b) => b.book.id === bookId))
    .sort((a, b) => rank(a) - rank(b));
  return ranked[0] ?? null;
}

export function nextInSeries(
  db: Db,
  profileId: string,
  bookId: string,
  version?: number,
): NextInSeries | null {
  const { held } = built(db, profileId, version);
  const series = mainSeriesOf(db, profileId, bookId, version);
  if (!series) return null;
  const at = series.books.findIndex((b) => b.book.id === bookId);
  const current = series.books[at];
  if (!current) return null;
  const { key, name, author } = series;
  const head = { key, name, author };
  const later = series.books.slice(at + 1);
  const unfinished = later.find((b) => b.book.finishedAt === null && !b.book.missing);
  // In the listener's own order, the next book is simply the next one.
  if (series.ordered) {
    return unfinished
      ? {
          series: head,
          book: unfinished.book,
          position: unfinished.position,
          number: unfinished.number,
        }
      : null;
  }
  const wanted =
    current.number !== null && Number.isInteger(current.number) ? current.number + 1 : null;
  // A hidden book is one the listener has, so it is no number to look for either.
  const have =
    wanted !== null &&
    (series.books.some((b) => b.number === wanted) || held.get(series.key)?.has(wanted) === true);
  if (wanted !== null && !have && wanted <= MAX_GAP_NUMBER) {
    return { series: head, book: null, position: String(wanted), number: wanted };
  }
  return unfinished
    ? {
        series: head,
        book: unfinished.book,
        position: unfinished.position,
        number: unfinished.number,
      }
    : null;
}
