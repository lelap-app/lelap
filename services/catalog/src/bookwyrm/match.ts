import type { MetaPreview } from '@lelap/sdk';

import { OPEN_LIBRARY, parseSearch } from '../openlibrary';
import { searchWords } from '../text';
import { TTL, type Upstream } from '../upstream';
import type { ShelvedBook } from './instance';

// A shelved edition becomes an Open Library work, so it opens and plays like any other book: by
// its Open Library edition key, then its ISBN, then its title and author.

export const PREFIX = 'bookwyrm:';
const FIELDS = 'key,title,author_name,first_publish_year,cover_i';
/** Open Library searches at once, for one page of a shelf. */
const PARALLEL = 4;

const search = (params: Record<string, string>) =>
  `${OPEN_LIBRARY}/search.json?${new URLSearchParams({ ...params, fields: FIELDS, limit: '1' })}`;

/** The Open Library searches to try for a book, best first. */
export function searchesFor(book: ShelvedBook): string[] {
  const urls: string[] = [];
  if (book.openLibrary) urls.push(search({ q: `edition_key:${book.openLibrary}` }));
  if (book.isbn) urls.push(search({ q: `isbn:${book.isbn}` }));
  // A title alone finds too many other books; only with the author.
  const title = searchWords(book.title).join(' ');
  const author = book.author ? searchWords(book.author, 4).join(' ') : '';
  if (title && author) urls.push(search({ title, author }));
  return urls;
}

/** The book's work on Open Library, or null when no search finds one. */
export async function openLibraryWork(
  upstream: Upstream,
  book: ShelvedBook,
): Promise<MetaPreview | null> {
  for (const url of searchesFor(book)) {
    try {
      const [work] = parseSearch(await upstream.json(url, { ttl: TTL.item }));
      if (work) return work;
    } catch {
      // Open Library down: try the next way, then show the book unmatched.
    }
  }
  return null;
}

/** `bookwyrm:books.example/book/12` for a book on the instance. */
export function bookId(book: ShelvedBook): string {
  const url = new URL(book.url);
  return `${PREFIX}${url.host}${url.pathname}`;
}

/**
 * The book's host and path from its ID. A book first added on another instance keeps that
 * instance's host; only the listener's own instance is ever asked about it.
 */
export function bookPath(id: string): { host: string; path: string } | null {
  if (!id.startsWith(PREFIX)) return null;
  const match = /^([a-z0-9.-]+(?::\d+)?)(\/book\/\d+)$/i.exec(id.slice(PREFIX.length));
  return match?.[1] && match[2] ? { host: match[1].toLowerCase(), path: match[2] } : null;
}

/**
 * Rows for a page of a shelf: a matched book under its `ol:` work, with BookWyrm's title and
 * cover where it has them; an unmatched one under `bookwyrm:`, which opens the book's page.
 */
export async function previews(upstream: Upstream, books: ShelvedBook[]): Promise<MetaPreview[]> {
  const out: (MetaPreview | null)[] = Array.from({ length: books.length }, () => null);
  let next = 0;
  const worker = async () => {
    while (next < books.length) {
      const index = next++;
      const book = books[index];
      if (!book) continue;
      const work = await openLibraryWork(upstream, book);
      const author = book.author ?? work?.author;
      const cover = book.cover ?? work?.cover;
      out[index] = {
        id: work?.id ?? bookId(book),
        type: 'audiobook',
        name: book.title,
        ...(author ? { author } : {}),
        ...(cover ? { cover } : {}),
        ...(work?.year ? { year: work.year } : {}),
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, books.length) }, worker));
  // Every book is kept, even two editions of one work, so `skip` counts match the shelf's pages.
  return out.flatMap((preview) => (preview ? [preview] : []));
}
