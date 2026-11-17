import type { Db } from '../db';
import { setFinished } from '../library/queries';
import { getTags, normalizeTag, setTags } from '../organise';
import { csvRecords } from './csv';
import { bookIndex, findBook } from './match';
import { ImportError, type ImportSummary } from './summary';

// Goodreads exports a CSV (My Books → Import and export). Shelves become tags and the "read"
// shelf a finished mark, for books that are in the library. Goodreads has no audio, so books
// that are not here are reported, never added.

export type GoodreadsBook = {
  title: string;
  authors: string[];
  isbn: string | null;
  /** Every shelf, the exclusive one (read, currently-reading, to-read) first. */
  shelves: string[];
  /** When it was read, from "Date Read"; null if not read or not dated. */
  readAt: number | null;
};

// Goodreads writes ISBNs as spreadsheet formulas, ="0441013597", so they keep leading zeros.
const unformula = (text: string) => text.replace(/^="?|"$/g, '').trim();

function parseDate(text: string): number | null {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(text.trim());
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

const list = (text: string | undefined) =>
  (text ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

export function parseGoodreads(text: string): GoodreadsBook[] {
  const records = csvRecords(text);
  const first = records[0];
  if (!first || !('Title' in first) || !('Exclusive Shelf' in first)) {
    throw new ImportError('This is not a Goodreads library export.');
  }
  return records
    .filter((r) => (r.Title ?? '').trim() !== '')
    .map((r) => {
      const exclusive = (r['Exclusive Shelf'] ?? '').trim();
      const isbn = unformula(r.ISBN13 ?? '') || unformula(r.ISBN ?? '');
      return {
        title: (r.Title ?? '').trim(),
        authors: [r.Author ?? '', ...list(r['Additional Authors'])].filter((a) => a.trim() !== ''),
        isbn: isbn === '' ? null : isbn,
        shelves: [...new Set([exclusive, ...list(r.Bookshelves)].filter((s) => s !== ''))],
        readAt: parseDate(r['Date Read'] ?? ''),
      };
    });
}

/** Tags matched books with their shelves and marks those on "read" finished. */
export function applyGoodreads(
  db: Db,
  profileId: string,
  items: GoodreadsBook[],
  now: number,
): ImportSummary {
  const index = bookIndex(db, profileId);
  const summary: ImportSummary = { matched: 0, skipped: [] };
  for (const item of items) {
    const book = findBook(index, item.title, item.authors);
    if (!book) {
      summary.skipped.push({ item: item.title, reason: 'Not in your library' });
      continue;
    }
    summary.matched++;
    const tags = getTags(db, profileId, book.id);
    const wanted = item.shelves.filter((s) => s !== 'read').map(normalizeTag);
    if (wanted.some((t) => !tags.includes(t))) {
      setTags(db, profileId, book.id, [...tags, ...wanted], now);
    }
    if (item.shelves.includes('read') && book.finishedAt === null) {
      setFinished(db, profileId, book.id, true, now, item.readAt ?? now);
    }
  }
  return summary;
}
