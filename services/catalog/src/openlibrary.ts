import type { Meta, MetaPreview } from '@lelap/sdk';
import { z } from 'zod';

import { first, truncate, unique, yearOf } from './text';
import { TTL, type Upstream } from './upstream';

export const OPEN_LIBRARY = 'https://openlibrary.org';
export const COVERS = 'https://covers.openlibrary.org';
export const PREFIX = 'ol:';
export const PAGE_SIZE = 30;

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const SearchDoc = z.object({
  key: z.string().regex(/^\/works\/OL\d+W$/),
  title: z.string().min(1),
  author_name: lenient(z.array(z.string())),
  first_publish_year: lenient(z.number().int()),
  cover_i: lenient(z.number().int().positive()),
});

const SearchResponse = z.object({ docs: z.array(z.unknown()) });

const AuthorRef = z.union([
  z.object({ author: z.object({ key: z.string() }) }),
  z.object({ key: z.string() }),
]);

const Work = z.object({
  key: z.string(),
  title: lenient(z.string()),
  type: lenient(z.object({ key: z.string() })),
  location: lenient(z.string()),
  description: lenient(z.union([z.string(), z.object({ value: z.string() })])),
  subjects: lenient(z.array(z.string())),
  covers: lenient(z.array(z.number().int())),
  authors: lenient(z.array(z.unknown())),
  first_publish_date: lenient(z.string()),
});
export type Work = z.infer<typeof Work>;

const Author = z.object({ name: z.string().min(1) });

const Edition = z.object({
  physical_format: lenient(z.string()),
  identifiers: lenient(z.object({ amazon: lenient(z.array(z.string())) })),
});
const Editions = z.object({ entries: z.array(z.unknown()) });

/** Audible ASINs start with B0; ten-digit ISBNs in the same field are print or CD editions. */
const AUDIBLE_ASIN = /^B0[0-9A-Z]{8}$/;

/** `OL69612W` from `ol:OL69612W`, or null for anything that is not a work ID. */
export function workIdOf(id: string): string | null {
  const value = id.startsWith(PREFIX) ? id.slice(PREFIX.length) : '';
  return /^OL\d+W$/.test(value) ? value : null;
}

export function searchUrl(query: string, skip: number): string {
  const params = new URLSearchParams({
    q: query,
    fields: 'key,title,author_name,first_publish_year,cover_i',
    limit: String(PAGE_SIZE),
    offset: String(skip),
  });
  return `${OPEN_LIBRARY}/search.json?${params}`;
}

export function coverUrl(coverId: number, size: 'M' | 'L' = 'M'): string {
  return `${COVERS}/b/id/${coverId}-${size}.jpg`;
}

export function parseSearch(data: unknown): MetaPreview[] {
  const parsed = SearchResponse.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data.docs.flatMap((raw) => {
    const result = SearchDoc.safeParse(raw);
    if (!result.success) return [];
    const doc = result.data;
    const preview: MetaPreview = {
      id: `${PREFIX}${doc.key.slice('/works/'.length)}`,
      type: 'audiobook',
      name: doc.title,
    };
    const author = first(doc.author_name);
    if (author) preview.author = author;
    if (doc.first_publish_year) preview.year = doc.first_publish_year;
    if (doc.cover_i) preview.cover = coverUrl(doc.cover_i);
    return [preview];
  });
}

/** Fetches a work, following one redirect (merged works). */
export async function fetchWork(upstream: Upstream, workId: string): Promise<Work | null> {
  let path = `/works/${workId}`;
  for (let hop = 0; hop < 2; hop++) {
    const parsed = Work.safeParse(
      await upstream.json(`${OPEN_LIBRARY}${path}.json`, { ttl: TTL.item }),
    );
    if (!parsed.success) return null;
    const work = parsed.data;
    if (work.type?.key !== '/type/redirect') return work;
    if (!work.location?.startsWith('/works/')) return null;
    path = work.location;
  }
  return null;
}

function authorKeys(work: Work): string[] {
  return (work.authors ?? []).flatMap((raw) => {
    const result = AuthorRef.safeParse(raw);
    if (!result.success) return [];
    const key = 'author' in result.data ? result.data.author.key : result.data.key;
    return /^\/authors\/OL\d+A$/.test(key) ? [key] : [];
  });
}

/** Names of the work's first authors; failures are skipped. */
export async function authorNames(upstream: Upstream, work: Work, max = 2): Promise<string[]> {
  const results = await Promise.allSettled(
    authorKeys(work)
      .slice(0, max)
      .map(
        async (key) =>
          Author.parse(await upstream.json(`${OPEN_LIBRARY}${key}.json`, { ttl: TTL.item })).name,
      ),
  );
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

/**
 * The Audible ASIN of an audio edition of the work, if Open Library records one. Editions marked
 * as Audible come first; ebooks have ASINs too, so only audio formats count.
 */
export async function audioAsin(upstream: Upstream, workId: string): Promise<string | null> {
  const parsed = Editions.safeParse(
    await upstream.json(`${OPEN_LIBRARY}/works/${workId}/editions.json?limit=100`, {
      ttl: TTL.item,
    }),
  );
  if (!parsed.success) return null;
  const candidates = parsed.data.entries.flatMap((raw) => {
    const edition = Edition.safeParse(raw).data;
    const format = edition?.physical_format?.toLowerCase() ?? '';
    if (!/audi|mp3/.test(format)) return [];
    const asin = edition?.identifiers?.amazon?.find((id) => AUDIBLE_ASIN.test(id));
    return asin ? [{ asin, audible: format.includes('audible') }] : [];
  });
  return (candidates.find((c) => c.audible) ?? candidates[0])?.asin ?? null;
}

/** Open Library descriptions are Markdown with a source footer; keep the prose. */
export function cleanDescription(text: string): string {
  const [prose = ''] = text.split(/\r?\n-{3,}\r?\n/);
  return prose
    .replace(/^\s*\[\d+\]:\s*\S+.*$/gm, '')
    .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function workMeta(upstream: Upstream, id: string): Promise<Meta | null> {
  const workId = workIdOf(id);
  if (!workId) return null;
  const work = await fetchWork(upstream, workId);
  if (!work?.title) return null;
  const meta: Meta = {
    id,
    type: 'audiobook',
    name: work.title,
    link: `${OPEN_LIBRARY}/works/${workId}`,
    externalIds: { ol: workId },
  };
  const [authors, asin] = await Promise.all([
    authorNames(upstream, work),
    // A merged work's editions live under the work it points to.
    audioAsin(upstream, workIdOf(`${PREFIX}${work.key.replace('/works/', '')}`) ?? workId).catch(
      () => null,
    ),
  ]);
  if (asin) meta.externalIds = { ol: workId, asin };
  if (authors.length > 0) meta.author = authors.join(', ');
  const raw = typeof work.description === 'string' ? work.description : work.description?.value;
  const description = raw ? cleanDescription(raw) : '';
  if (description) meta.description = truncate(description, 4000);
  if (work.subjects?.length) meta.genres = unique(work.subjects).slice(0, 10);
  const cover = work.covers?.find((coverId) => coverId > 0);
  if (cover) meta.cover = coverUrl(cover, 'L');
  const year = yearOf(work.first_publish_date);
  if (year) meta.year = year;
  return meta;
}
