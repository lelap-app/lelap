import type { MetaPreview } from '@lelap/sdk';

import { type Fetcher, fetchCatalog, type InstalledAddon, searchCatalogs } from '../addons/client';
import type { Db } from '../db';
import type { GoodreadsBook } from './goodreads';
import { bookIndex, findBook, sameAuthor, titleKey } from './match';

// Goodreads' to-read shelf (M102): the books there that are not in the library are looked up in
// the add-ons' search catalogs, the Catalog's Open Library search first, and kept as a Want to
// read list on Home. Only the title, author and ISBN go out, one book at a time.

export const GOODREADS_TO_READ = 'to-read';
/** At most this many books are looked up per import, so a long shelf doesn't hammer a catalog. */
export const WANTED_LOOKUPS = 200;

/** Books on the to-read shelf that the library lacks. */
export function wantedFromGoodreads(
  db: Db,
  profileId: string,
  items: GoodreadsBook[],
): GoodreadsBook[] {
  const index = bookIndex(db, profileId);
  return items.filter(
    (item) =>
      item.shelves[0] === GOODREADS_TO_READ && findBook(index, item.title, item.authors) === null,
  );
}

/** Whether a search result is the book: the same title, and an author in common when both say. */
export function isSameBook(meta: MetaPreview, book: GoodreadsBook): boolean {
  return titleKey(meta.name) === titleKey(book.title) && byAuthor(meta, book);
}

/** An audiobook by one of the book's authors, or one that names none. */
function byAuthor(meta: MetaPreview, book: GoodreadsBook): boolean {
  if (meta.type !== 'audiobook') return false;
  if (!meta.author || book.authors.length === 0) return true;
  return book.authors.some((a) => sameAuthor(a, meta.author ?? ''));
}

export type WantedLookup = {
  found: (MetaPreview & { from: GoodreadsBook })[];
  /** Titles no catalog had, or that were past the limit. */
  missing: string[];
  /** Catalogs that failed, by add-on name: nothing was found there, not nothing exists. */
  failed: string[];
};

/**
 * Looks each book up by ISBN, then by title and author, in the search catalogs of `addons`, the
 * ones whose add-on knows Open Library IDs first. `onProgress` hears each book as it starts.
 */
export async function lookUpWanted(
  fetcher: Fetcher,
  addons: InstalledAddon[],
  books: GoodreadsBook[],
  onProgress: (done: number, total: number) => void = () => {},
): Promise<WantedLookup> {
  const knowsOl = (a: InstalledAddon) => (a.manifest.idPrefixes ?? []).includes('ol:');
  const refs = searchCatalogs(addons, ['audiobook']).sort(
    (a, b) => Number(knowsOl(b.addon)) - Number(knowsOl(a.addon)),
  );
  const result: WantedLookup = { found: [], missing: [], failed: [] };
  const failed = new Set<string>();
  const asked = books.slice(0, WANTED_LOOKUPS);
  for (const [i, book] of asked.entries()) {
    onProgress(i, asked.length);
    const queries = [
      ...(book.isbn ? [book.isbn] : []),
      [book.title, book.authors[0]].filter(Boolean).join(' '),
    ];
    let hit: MetaPreview | null = null;
    search: for (const query of queries) {
      for (const ref of refs) {
        let metas: MetaPreview[];
        try {
          metas = await fetchCatalog(fetcher, ref, { search: query });
        } catch {
          failed.add(ref.addon.manifest.name);
          continue;
        }
        // An ISBN names the book, whatever its title in the catalog (“1984”, or spelled out).
        hit =
          metas
            .slice(0, 10)
            .find((m) => (query === book.isbn ? byAuthor(m, book) : isSameBook(m, book))) ?? null;
        if (hit) break search;
      }
    }
    if (hit) result.found.push({ ...hit, from: book });
    else result.missing.push(book.title);
  }
  for (const book of books.slice(WANTED_LOOKUPS)) result.missing.push(book.title);
  onProgress(asked.length, asked.length);
  result.failed = [...failed];
  return result;
}
