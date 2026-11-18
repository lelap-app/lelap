import { normalizeId, normalizeIds, type WorkInfo } from './match';

export type LookupOptions = {
  /** Defaults to the global `fetch`. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Open Library's address, for a mirror or a test server. */
  openLibrary?: string;
  /** Gives up on each request after this long. */
  timeoutMs?: number;
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * What a source add-on needs to find its files for a work's ID, for `createWorkIndex().find`.
 * `isbn:` and `asin:` IDs are their own answer and cost no request. `ol:` work IDs are looked up
 * at Open Library: the title, up to three authors and the ISBNs and ASINs of its editions. Null
 * for an ID it can't use or a work Open Library doesn't know.
 *
 * Runs in your add-on, on your server; the Lelap app never calls it.
 */
export async function lookupWork(
  id: string,
  options: LookupOptions = {},
): Promise<WorkInfo | null> {
  const normal = normalizeId(id);
  if (!normal) return null;
  if (normal.startsWith('isbn:') || normal.startsWith('asin:')) return { ids: [normal] };
  const workId = /^ol:(OL\d+W)$/.exec(normal)?.[1];
  if (!workId) return null;

  const base = (options.openLibrary ?? 'https://openlibrary.org').replace(/\/+$/, '');
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const get = async (path: string): Promise<Json | null> => {
    try {
      const response = await fetcher(`${base}${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return isObject(body) ? body : null;
    } catch {
      return null;
    }
  };

  const work = await get(`/works/${workId}.json`);
  if (!work || typeof work.title !== 'string') return null;
  const authorKeys = (Array.isArray(work.authors) ? work.authors : [])
    .map((a) => (isObject(a) && isObject(a.author) ? a.author.key : undefined))
    .filter((key): key is string => typeof key === 'string' && /^\/authors\/OL\d+A$/.test(key))
    .slice(0, 3);
  const [authors, editions] = await Promise.all([
    Promise.all(authorKeys.map((key) => get(`${key}.json`))),
    get(`/works/${workId}/editions.json?limit=100`),
  ]);
  const ids = [normal];
  for (const edition of Array.isArray(editions?.entries) ? editions.entries : []) {
    if (!isObject(edition)) continue;
    for (const isbn of [...strings(edition.isbn_13), ...strings(edition.isbn_10)]) {
      ids.push(`isbn:${isbn}`);
    }
    const identifiers = isObject(edition.identifiers) ? edition.identifiers : {};
    for (const asin of [...strings(identifiers.amazon), ...strings(identifiers.asin)]) {
      ids.push(`asin:${asin}`);
    }
  }
  return {
    title: work.title,
    authors: authors.flatMap((a) => (a && typeof a.name === 'string' ? [a.name] : [])),
    ids: normalizeIds(ids),
  };
}
