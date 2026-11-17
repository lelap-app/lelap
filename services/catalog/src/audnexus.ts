import type { Chapter, Meta, Series } from '@lelap/sdk';
import { z } from 'zod';

import { htmlToText, httpUrl, truncate, unique, yearOf } from './text';
import { TTL, type Upstream, UpstreamError } from './upstream';

/**
 * Audnexus (https://github.com/laxamentumtech/audnexus): narrators, series and chapters of
 * audiobooks, keyed by ASIN. Metadata only; it never sees or serves audio.
 */
export const AUDNEXUS = 'https://api.audnex.us';
export const PREFIX = 'asin:';

/** Audible ASINs: ten capitals and digits. */
const ASIN = /^[0-9A-Z]{10}$/;

/** The ASIN in `asin:B002UZMLXM`, or null. */
export function asinOf(id: string): string | null {
  const value = id.startsWith(PREFIX) ? id.slice(PREFIX.length) : '';
  return ASIN.test(value) ? value : null;
}

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const Named = z.object({ name: z.string().min(1) });
const names = (raw: unknown[] | undefined) =>
  unique(
    (raw ?? []).flatMap((n) => {
      const parsed = Named.safeParse(n);
      return parsed.success ? [parsed.data.name.trim()] : [];
    }),
  );

const SeriesRef = z.object({ name: z.string().min(1), position: lenient(z.string()) });

const Book = z.object({
  asin: z.string(),
  title: z.string().min(1),
  authors: lenient(z.array(z.unknown())),
  narrators: lenient(z.array(z.unknown())),
  seriesPrimary: lenient(SeriesRef),
  seriesSecondary: lenient(SeriesRef),
  description: lenient(z.string()),
  summary: lenient(z.string()),
  image: lenient(z.string()),
  genres: lenient(z.array(z.object({ name: z.string(), type: lenient(z.string()) }))),
  releaseDate: lenient(z.string()),
  runtimeLengthMin: lenient(z.number().nonnegative()),
});
type Book = z.infer<typeof Book>;

const ChapterList = z.object({
  runtimeLengthMs: z.number().int().positive(),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        startOffsetMs: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

/** What Audnexus knows about one ASIN. `failed` means it could not be asked: try again soon. */
export type Details =
  | { status: 'ok'; book: Book | null; chapters: Chapter[]; durationMs: number | null }
  | { status: 'missing' }
  | { status: 'failed' };

const seriesOf = (book: Book): Series[] =>
  [book.seriesPrimary, book.seriesSecondary].flatMap((s) =>
    s ? [s.position ? { name: s.name, position: s.position } : { name: s.name }] : [],
  );

/** Chapters must start at zero and go forward, or they are not a usable list. */
function cleanChapters(list: z.infer<typeof ChapterList>['chapters'], durationMs: number) {
  const chapters = list.map((c) => ({ title: c.title.trim(), startMs: c.startOffsetMs }));
  let previous = -1;
  const ordered = chapters.every((c) => {
    const ok = c.startMs < durationMs && (previous < 0 ? c.startMs === 0 : c.startMs > previous);
    previous = c.startMs;
    return ok;
  });
  return ordered ? chapters : [];
}

export type Audnexus = {
  details: (asin: string) => Promise<Details>;
  /** Adds narrators, series, length and chapters to a meta with an ASIN; never throws. */
  enrich: (meta: Meta) => Promise<{ meta: Meta; failed: boolean }>;
  /** A whole meta for an `asin:` ID. */
  meta: (id: string) => Promise<{ meta: Meta | null; failed: boolean }>;
};

export function createAudnexus(upstream: Upstream): Audnexus {
  // Audnexus allows a few hundred requests a minute per address. After a 429 the isolate stops
  // asking until the window is over, and metas go out without its details meanwhile.
  let pausedUntil = 0;

  const get = async (url: string): Promise<unknown> => {
    try {
      return await upstream.json(url, { ttl: TTL.reference, cacheMisses: true });
    } catch (error) {
      if (error instanceof UpstreamError && (error.status === 429 || error.status === 503))
        pausedUntil = upstream.now() + (error.retryAfter ?? 60) * 1000;
      throw error;
    }
  };

  const details = async (asin: string): Promise<Details> => {
    if (!ASIN.test(asin) || upstream.now() < pausedUntil) {
      return { status: ASIN.test(asin) ? 'failed' : 'missing' };
    }
    const base = `${AUDNEXUS}/books/${asin}`;
    const [bookResult, chaptersResult] = await Promise.allSettled([
      get(base),
      get(`${base}/chapters`),
    ]);
    if (bookResult.status === 'rejected' && chaptersResult.status === 'rejected')
      return { status: 'failed' };
    const book =
      bookResult.status === 'fulfilled' ? (Book.safeParse(bookResult.value).data ?? null) : null;
    const list =
      chaptersResult.status === 'fulfilled'
        ? (ChapterList.safeParse(chaptersResult.value).data ?? null)
        : null;
    if (!book && !list) {
      return bookResult.status === 'rejected' || chaptersResult.status === 'rejected'
        ? { status: 'failed' }
        : { status: 'missing' };
    }
    const durationMs =
      list?.runtimeLengthMs ?? (book?.runtimeLengthMin ? book.runtimeLengthMin * 60_000 : null);
    return {
      status: 'ok',
      book,
      chapters: list ? cleanChapters(list.chapters, list.runtimeLengthMs) : [],
      durationMs,
    };
  };

  return {
    details,
    async enrich(meta) {
      const asin = meta.externalIds?.asin;
      if (!asin) return { meta, failed: false };
      const found = await details(asin);
      if (found.status !== 'ok') return { meta, failed: found.status === 'failed' };
      const enriched: Meta = { ...meta };
      const narrators = found.book ? names(found.book.narrators) : [];
      if (narrators.length > 0 && !meta.narrators?.length) enriched.narrators = narrators;
      const series = found.book ? seriesOf(found.book) : [];
      if (series.length > 0 && !meta.series?.length) enriched.series = series;
      // Length and chapters travel together: the chapters only fit a recording of this length.
      if (found.durationMs && !meta.chapters?.length) {
        enriched.durationMs = found.durationMs;
        if (found.chapters.length > 0) enriched.chapters = found.chapters;
      }
      return { meta: enriched, failed: false };
    },
    async meta(id) {
      const asin = asinOf(id);
      if (!asin) return { meta: null, failed: false };
      const found = await details(asin);
      if (found.status !== 'ok' || !found.book)
        return { meta: null, failed: found.status === 'failed' };
      const { book } = found;
      const meta: Meta = { id, type: 'audiobook', name: book.title, externalIds: { asin } };
      const authors = names(book.authors);
      if (authors.length > 0) meta.author = authors.slice(0, 2).join(', ');
      const narrators = names(book.narrators);
      if (narrators.length > 0) meta.narrators = narrators;
      const series = seriesOf(book);
      if (series.length > 0) meta.series = series;
      const cover = httpUrl(book.image);
      if (cover) meta.cover = cover;
      const description = book.summary ? htmlToText(book.summary) : (book.description ?? '');
      if (description) meta.description = truncate(description, 4000);
      const genres = (book.genres ?? []).filter((g) => g.type === 'genre').map((g) => g.name);
      if (genres.length > 0) meta.genres = unique(genres);
      const year = yearOf(book.releaseDate);
      if (year) meta.year = year;
      if (found.durationMs) meta.durationMs = found.durationMs;
      if (found.chapters.length > 0) meta.chapters = found.chapters;
      return { meta, failed: false };
    },
  };
}
