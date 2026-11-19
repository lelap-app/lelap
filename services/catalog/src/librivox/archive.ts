import type { Chapter, Meta, MetaPreview, Stream, StreamPart } from '@lelap/sdk';
import { z } from 'zod';

import { first, htmlToText, naturalCompare, parseDuration, unique, yearOf } from '../text';

// archive.org's `librivoxaudio` collection mirrors every LibriVox recording with full metadata
// and per-chapter MP3s; its search API matches anywhere in a title, unlike LibriVox's own.
export const ARCHIVE = 'https://archive.org';
export const COLLECTION = 'librivoxaudio';
export const PREFIX = 'librivox:';

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const Text = lenient(z.union([z.string(), z.array(z.string())]));
const Scalar = lenient(z.union([z.string(), z.number()]));

const SearchDoc = z.object({
  identifier: z.string().min(1),
  title: Text,
  creator: Text,
  runtime: Scalar,
  date: Scalar,
  avg_rating: Scalar,
  num_reviews: Scalar,
});
type SearchDoc = z.infer<typeof SearchDoc>;

const SearchResponse = z.object({
  response: z.object({ docs: z.array(z.unknown()) }),
});

const ArchiveFile = z.object({
  name: z.string().min(1),
  format: lenient(z.string()),
  title: lenient(z.string()),
  track: Scalar,
  length: Scalar,
  size: Scalar,
  original: lenient(z.string()),
});
type ArchiveFile = z.infer<typeof ArchiveFile>;

const Item = z.object({
  metadata: z.object({
    identifier: z.string().min(1),
    title: Text,
    creator: Text,
    description: Text,
    date: Scalar,
    year: Scalar,
    subject: Text,
    language: Text,
    call_number: Scalar,
    runtime: Scalar,
    collection: Text,
  }),
  files: z.array(z.unknown()).catch([]),
  reviews: z.array(z.unknown()).catch([]),
});
const Review = z.object({ stars: Scalar });
export type Item = {
  metadata: z.infer<typeof Item>['metadata'];
  files: ArchiveFile[];
  /** The stars of each review, 1 to 5. */
  reviews?: number[];
};

export const SEARCH_FIELDS = [
  'identifier',
  'title',
  'creator',
  'runtime',
  'subject',
  'date',
  'avg_rating',
  'num_reviews',
];

// One or two reviews say little about a recording; below this the cover gets no rating.
export const MIN_REVIEWS = 3;

/** archive.org's average review, 1 to 5 stars, rounded to a tenth; none from too few reviews. */
export function ratingOf(doc: Pick<SearchDoc, 'avg_rating' | 'num_reviews'>): number | undefined {
  const rating = Number.parseFloat(String(doc.avg_rating));
  const reviews = Number.parseFloat(String(doc.num_reviews));
  if (!Number.isFinite(rating) || !Number.isFinite(reviews) || reviews < MIN_REVIEWS) return;
  if (rating < 0 || rating > 5) return;
  return Math.round(rating * 10) / 10;
}

export type SearchQuery = {
  /** Lucene, built only from `wordsQuery`, `genreQuery` and `lookupQuery`; empty for all. */
  query: string;
  sort?: string;
  rows: number;
  page: number;
  fields?: string[];
};

export function searchUrl({
  query,
  sort,
  rows,
  page,
  fields = SEARCH_FIELDS,
}: SearchQuery): string {
  const params = new URLSearchParams();
  const base = `collection:${COLLECTION} AND mediatype:audio`;
  params.set('q', query ? `${base} AND (${query})` : base);
  for (const field of fields) params.append('fl[]', field);
  params.set('rows', String(rows));
  params.set('page', String(page));
  if (sort) params.append('sort[]', sort);
  params.set('output', 'json');
  return `${ARCHIVE}/advancedsearch.php?${params}`;
}

/** Every word must appear in the title or the author; words come from `searchWords`. */
export function wordsQuery(words: string[]): string {
  return words.map((word) => `(title:${word} OR creator:${word})`).join(' AND ');
}

/** `genre` must be one of the manifest's options, never raw user input. */
export function genreQuery(genre: string): string {
  return `subject:"${genre}"`;
}

/** Title words and the author's surname, for finding recordings of an Open Library work. */
export function lookupQuery(titleWords: string[], authorWords: string[]): string {
  const title = `title:(${titleWords.join(' AND ')})`;
  return authorWords.length > 0 ? `${title} AND creator:(${authorWords.join(' AND ')})` : title;
}

/** The documents of one answer as archive.org sent them, unchecked, so they can be counted. */
export function searchDocs(data: unknown): unknown[] {
  const parsed = SearchResponse.safeParse(data);
  return parsed.success ? parsed.data.response.docs : [];
}

export function parseDocs(docs: unknown[]): SearchDoc[] {
  return docs.flatMap((doc) => {
    const result = SearchDoc.safeParse(doc);
    return result.success ? [result.data] : [];
  });
}

export function parseSearch(data: unknown): SearchDoc[] {
  return parseDocs(searchDocs(data));
}

export function parseItem(data: unknown): Item | null {
  // Unknown identifiers come back as `{}`.
  const parsed = Item.safeParse(data);
  if (!parsed.success) return null;
  const collections = [parsed.data.metadata.collection ?? []].flat();
  // Only LibriVox recordings: this add-on is not a general archive.org browser.
  if (!collections.includes(COLLECTION)) return null;
  const files = parsed.data.files.flatMap((file) => {
    const result = ArchiveFile.safeParse(file);
    return result.success ? [result.data] : [];
  });
  const reviews = parsed.data.reviews.flatMap((review) => {
    const stars = Number.parseFloat(String(Review.safeParse(review).data?.stars));
    return Number.isFinite(stars) ? [stars] : [];
  });
  return { metadata: parsed.data.metadata, files, reviews };
}

export const metadataUrl = (identifier: string) =>
  `${ARCHIVE}/metadata/${encodeURIComponent(identifier)}`;

export const coverUrl = (identifier: string) =>
  `${ARCHIVE}/services/img/${encodeURIComponent(identifier)}`;

/** A file inside an item, straight from archive.org. */
export const downloadUrl = (identifier: string, name: string) =>
  `${ARCHIVE}/download/${encodeURIComponent(identifier)}/${name
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

export const durationOf = (value: string | number | undefined) =>
  parseDuration(typeof value === 'number' ? String(value) : value);

export function toPreview(doc: SearchDoc): MetaPreview | null {
  const name = first(doc.title);
  if (!name) return null;
  const preview: MetaPreview = {
    id: `${PREFIX}${doc.identifier}`,
    type: 'audiobook',
    name,
    cover: coverUrl(doc.identifier),
  };
  const author = first(doc.creator);
  if (author) preview.author = author;
  const year = yearOf(doc.date);
  if (year) preview.year = year;
  const durationMs = durationOf(doc.runtime);
  if (durationMs) preview.durationMs = durationMs;
  const rating = ratingOf(doc);
  if (rating !== undefined) preview.badges = { rating };
  return preview;
}

const BOILERPLATE = /^(for further information|for more free audio|download m4b|m4b audiobook)/i;

/** The description as text, without LibriVox's standard footer and download links. */
export function cleanDescription(html: string): string {
  return htmlToText(html)
    .split('\n')
    .filter((line) => !BOILERPLATE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The reader credit from a LibriVox description: `Read by Kara Shallenberg`. */
export function readerOf(description: string): string | undefined {
  const match = description.match(
    /\bRead (?:in [A-Z][a-z]+ )?by:?\s+(.+?)(?:(?<=\p{Ll}{2})\.(?=\s|$)|\n|$)/mu,
  );
  const reader = match?.[1]?.trim();
  return reader && reader.length <= 120 ? reader : undefined;
}

const FORMATS = [
  { format: '64Kbps MP3', key: '64kb' },
  { format: 'VBR MP3', key: 'vbr' },
  { format: '128Kbps MP3', key: '128kb' },
] as const;

export const trackNumber = (value: string | number | undefined): number | undefined => {
  const track = typeof value === 'number' ? value : parseInt(value ?? '', 10);
  return Number.isFinite(track) ? track : undefined;
};

/** Audio files in play order, in the first format the item has. */
export function chooseParts(item: Item): { key: string; parts: StreamPart[] } | null {
  const identifier = item.metadata.identifier;
  for (const { format, key } of FORMATS) {
    const files = item.files.filter((file) => file.format === format);
    if (files.length === 0) continue;

    // Derivatives (64 kb) often lack `track`; their `original` file usually has it.
    const byName = new Map(item.files.map((file) => [file.name, file]));
    const tracks = new Map<ArchiveFile, number | undefined>(
      files.map((file) => [
        file,
        trackNumber(file.track) ??
          trackNumber(file.original ? byName.get(file.original)?.track : undefined),
      ]),
    );
    const allTracked = files.every((file) => tracks.get(file) !== undefined);
    const ordered = [...files].sort((a, b) =>
      allTracked
        ? (tracks.get(a) ?? 0) - (tracks.get(b) ?? 0) || naturalCompare(a.name, b.name)
        : naturalCompare(a.name, b.name),
    );

    const parts = ordered.map((file): StreamPart => {
      const part: StreamPart = {
        url: downloadUrl(identifier, file.name),
        durationMs: durationOf(file.length) ?? 0,
        title: file.title?.trim() || file.name.replace(/\.[^.]+$/, ''),
      };
      const size = trackNumber(file.size);
      if (size !== undefined && size >= 0) part.size = size;
      return part;
    });
    return { key, parts };
  }
  return null;
}

export function toStream(item: Item): Stream | null {
  const chosen = chooseParts(item);
  if (!chosen) return null;
  const { identifier, description } = item.metadata;
  const stream: Stream = {
    sourceKey: `${PREFIX}${identifier}:${chosen.key}`,
    name: 'LibriVox',
    mime: 'audio/mpeg',
    downloadable: true,
    parts: chosen.parts,
  };
  const reader = readerOf(cleanDescription(first(description) ?? ''));
  if (reader) stream.title = `Read by ${reader}`;
  const sizes = chosen.parts.map((part) => part.size);
  if (sizes.every((size) => size !== undefined))
    stream.size = sizes.reduce<number>((total, size) => total + (size ?? 0), 0);
  return stream;
}

const IGNORED_SUBJECTS = new Set([
  'librivox',
  'audiobook',
  'audiobooks',
  'audio book',
  'literature',
]);

export function toMeta(item: Item): Meta | null {
  const { metadata } = item;
  const name = first(metadata.title);
  if (!name) return null;
  const identifier = metadata.identifier;
  const meta: Meta = {
    id: `${PREFIX}${identifier}`,
    type: 'audiobook',
    name,
    cover: coverUrl(identifier),
    link: `${ARCHIVE}/details/${encodeURIComponent(identifier)}`,
  };
  const author = first(metadata.creator);
  if (author) meta.author = author;

  const description = cleanDescription(first(metadata.description) ?? '');
  if (description) meta.description = description;
  const reader = readerOf(description);
  if (reader) meta.narrators = reader.split(/,\s*|\s+and\s+|\s*&\s*/).filter(Boolean);

  const year = yearOf(metadata.year) ?? yearOf(metadata.date);
  if (year) meta.year = year;
  const language = first(metadata.language);
  if (language) meta.language = language;

  // Uploaders often tag the title and author too ("burnett; secret garden"); those are not genres.
  const named = `${name} ${author ?? ''}`.toLowerCase();
  const subjects = [metadata.subject ?? []]
    .flat()
    .flatMap((subject) => subject.split(';'))
    .map((subject) => subject.trim())
    .filter(
      (subject) =>
        subject &&
        !IGNORED_SUBJECTS.has(subject.toLowerCase()) &&
        !named.includes(subject.toLowerCase()),
    );
  if (subjects.length > 0) meta.genres = unique(subjects).slice(0, 10);

  const externalIds: Record<string, string> = { archive: identifier };
  const callNumber = metadata.call_number;
  if (callNumber !== undefined && String(callNumber).trim())
    externalIds.librivox = String(callNumber).trim();
  meta.externalIds = externalIds;

  const chosen = chooseParts(item);
  let total: number | undefined;
  if (chosen) {
    let startMs = 0;
    meta.chapters = chosen.parts.map((part): Chapter => {
      const chapter = { title: part.title ?? '', startMs };
      startMs += part.durationMs;
      return chapter;
    });
    if (chosen.parts.every((part) => part.durationMs > 0)) total = startMs;
  }
  const durationMs = total ?? durationOf(metadata.runtime);
  if (durationMs) meta.durationMs = durationMs;

  // The same rating the catalog shows, worked out from the reviews themselves.
  const reviews = item.reviews ?? [];
  const rating = ratingOf({
    avg_rating: reviews.reduce((sum, stars) => sum + stars, 0) / reviews.length,
    num_reviews: reviews.length,
  });
  if (rating !== undefined) meta.badges = { rating };
  return meta;
}
