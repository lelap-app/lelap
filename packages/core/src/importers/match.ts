import type { Db } from '../db';
import { type HiddenFilter, type LibraryBook, listAllBooks } from '../library/queries';

// Other apps name books by title and author; Lelap's library has only what the files' tags
// say. Matching ignores case, accents, punctuation, subtitles and series notes.

const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A title without its series note ("(Dune, #1)"), subtitle and leading article. */
export function titleKey(title: string): string {
  const main = title.replace(/\([^)]*#\s*\d[^)]*\)/g, '').split(/[:;]| - /)[0] ?? title;
  return fold(main).replace(/^(the|a|an) /, '');
}

/** The words of an author's name, so "Le Guin, Ursula K." and "Ursula K. Le Guin" agree. */
function authorWords(author: string): Set<string> {
  return new Set(
    fold(author)
      .split(' ')
      .filter((w) => w.length > 1),
  );
}

export function sameAuthor(a: string, b: string): boolean {
  const left = authorWords(a);
  const right = authorWords(b);
  if (left.size === 0 || right.size === 0) return true;
  // The surname is usually the only word both spellings share.
  return [...left].some((w) => right.has(w));
}

/**
 * Books (not podcast episodes) on this device, indexed by title key. Hidden books too unless
 * `show` says otherwise: an import still finds a book the listener hid.
 */
export function bookIndex(
  db: Db,
  profileId: string,
  show: HiddenFilter = 'all',
): Map<string, LibraryBook[]> {
  const index = new Map<string, LibraryBook[]>();
  for (const book of listAllBooks(db, profileId, show)) {
    if (book.source === 'feed' || book.missing) continue;
    const key = titleKey(book.title);
    index.set(key, [...(index.get(key) ?? []), book]);
  }
  return index;
}

/** The library book with this title by this author, if exactly one fits. */
export function findBook(
  index: Map<string, LibraryBook[]>,
  title: string,
  authors: string[],
): LibraryBook | null {
  const candidates = (index.get(titleKey(title)) ?? []).filter(
    (b) =>
      b.author === null ||
      authors.length === 0 ||
      authors.some((a) => sameAuthor(a, b.author ?? '')),
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
