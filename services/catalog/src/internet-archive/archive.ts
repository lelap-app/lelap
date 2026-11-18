import type { Chapter, ContentType, Meta, MetaPreview, Stream, StreamPart } from '@lelap/sdk';
import { z } from 'zod';

import {
  ARCHIVE,
  cleanDescription,
  coverUrl,
  downloadUrl,
  durationOf,
  ratingOf,
  trackNumber,
} from '../librivox/archive';
import { first, naturalCompare, unique, yearOf } from '../text';
import { isFreeToShare, RIGHTS_QUERY } from './rights';

export const PREFIX = 'ia:';

/**
 * Old-time radio items are usually a whole series, one file per broadcast: listeners pick
 * episodes and want to know which they heard, so they are podcasts. Everything else (lectures,
 * readings) plays from the first file to the last, so it is an audiobook with chapters.
 */
export const PODCAST_COLLECTIONS: readonly string[] = ['oldtimeradio'];

export const OLD_TIME_RADIO = 'collection:oldtimeradio';
/** Spoken word beyond LibriVox: readings, poetry, Project Gutenberg's recordings, lectures. */
// Radio items tagged as lectures would be listed as audiobooks but open as podcasts.
export const SPOKEN_WORD =
  '(collection:(audio_bookspoetry OR gutenberg OR ucberkeleylectures) OR subject:(lecture OR lectures)) AND NOT collection:oldtimeradio';
export const LECTURES =
  '(collection:ucberkeleylectures OR subject:(lecture OR lectures)) AND NOT collection:oldtimeradio';
export const READINGS =
  'collection:(audio_bookspoetry OR gutenberg) AND NOT collection:oldtimeradio';

const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
const Text = lenient(z.union([z.string(), z.array(z.string())]));
const Scalar = lenient(z.union([z.string(), z.number()]));

const SearchDoc = z.object({
  identifier: z.string().min(1),
  title: Text,
  creator: Text,
  date: Scalar,
  avg_rating: Scalar,
  num_reviews: Scalar,
  licenseurl: Text,
  'possible-copyright-status': Text,
  'access-restricted-item': lenient(z.unknown()),
});
export type SearchDoc = z.infer<typeof SearchDoc>;

const SearchResponse = z.object({ response: z.object({ docs: z.array(z.unknown()) }) });

const ArchiveFile = z.object({
  name: z.string().min(1),
  format: lenient(z.string()),
  source: lenient(z.string()),
  title: lenient(z.string()),
  track: Scalar,
  length: Scalar,
  size: Scalar,
  original: lenient(z.string()),
  private: lenient(z.unknown()),
});
type ArchiveFile = z.infer<typeof ArchiveFile>;

const ItemSchema = z.object({
  metadata: z.object({
    identifier: z.string().min(1),
    mediatype: Text,
    title: Text,
    creator: Text,
    description: Text,
    date: Scalar,
    year: Scalar,
    publicdate: Scalar,
    subject: Text,
    language: Text,
    collection: Text,
    licenseurl: Text,
    'possible-copyright-status': Text,
    'access-restricted-item': lenient(z.unknown()),
  }),
  files: z.array(z.unknown()).catch([]),
  reviews: z.array(z.unknown()).catch([]),
});
const Review = z.object({ stars: Scalar });

export type Item = {
  metadata: z.infer<typeof ItemSchema>['metadata'];
  type: ContentType;
  files: ArchiveFile[];
  reviews: number[];
};

export const SEARCH_FIELDS = [
  'identifier',
  'title',
  'creator',
  'date',
  'avg_rating',
  'num_reviews',
  'licenseurl',
  'possible-copyright-status',
  'access-restricted-item',
];

export type SearchQuery = {
  /** Which part of archive.org: `OLD_TIME_RADIO`, `SPOKEN_WORD`, `LECTURES` or `READINGS`. */
  scope: string;
  /** Lucene from `wordsQuery` only; empty for all. */
  words?: string;
  sort?: string;
  rows: number;
  page: number;
};

export function searchUrl({ scope, words, sort, rows, page }: SearchQuery): string {
  // LibriVox has its own add-on; its recordings would only crowd these results.
  const parts = [
    'mediatype:audio',
    `(${scope})`,
    'NOT collection:librivoxaudio',
    'NOT access-restricted-item:true',
    RIGHTS_QUERY,
  ];
  if (words) parts.push(`(${words})`);
  const params = new URLSearchParams();
  params.set('q', parts.join(' AND '));
  for (const field of SEARCH_FIELDS) params.append('fl[]', field);
  params.set('rows', String(rows));
  params.set('page', String(page));
  if (sort) params.append('sort[]', sort);
  params.set('output', 'json');
  return `${ARCHIVE}/advancedsearch.php?${params}`;
}

/** Every word in the title, the creator or the subjects; words come from `searchWords`. */
export function wordsQuery(words: string[]): string {
  return words.map((word) => `(title:${word} OR creator:${word} OR subject:${word})`).join(' AND ');
}

/** Search results that are free to share; the search filter is only a first pass. */
export function parseSearch(data: unknown): SearchDoc[] {
  const parsed = SearchResponse.safeParse(data);
  if (!parsed.success) return [];
  return parsed.data.response.docs.flatMap((doc) => {
    const result = SearchDoc.safeParse(doc);
    if (!result.success) return [];
    const free = isFreeToShare({
      licenseurl: first(result.data.licenseurl),
      possibleCopyrightStatus: first(result.data['possible-copyright-status']),
      accessRestricted: restricted(result.data['access-restricted-item']),
    });
    return free ? [result.data] : [];
  });
}

export function toPreview(doc: SearchDoc, type: ContentType): MetaPreview | null {
  const name = first(doc.title);
  if (!name) return null;
  const preview: MetaPreview = {
    id: `${PREFIX}${doc.identifier}`,
    type,
    name,
    cover: coverUrl(doc.identifier),
  };
  const author = first(doc.creator);
  if (author) preview.author = author;
  const year = yearOf(doc.date);
  if (year) preview.year = year;
  const rating = ratingOf(doc);
  if (rating !== undefined) preview.badges = { rating };
  return preview;
}

/** Fails closed: any value other than absent, `false` or `"false"` counts as restricted. */
export function restricted(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  const values = Array.isArray(value) ? value : [value];
  return !values.every((v) => v === false || (typeof v === 'string' && /^\s*false\s*$/i.test(v)));
}

const isPrivate = (value: unknown) =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

/** An audio item that is free to share, or null for anything else, `{}` for unknown ones too. */
export function parseItem(data: unknown): Item | null {
  const parsed = ItemSchema.safeParse(data);
  if (!parsed.success) return null;
  const { metadata } = parsed.data;
  if (![metadata.mediatype ?? []].flat().includes('audio')) return null;
  const collections = [metadata.collection ?? []].flat();
  const free = isFreeToShare({
    licenseurl: first(metadata.licenseurl),
    possibleCopyrightStatus: first(metadata['possible-copyright-status']),
    collections,
    accessRestricted: restricted(metadata['access-restricted-item']),
  });
  if (!free) return null;
  const files = parsed.data.files.flatMap((file) => {
    const result = ArchiveFile.safeParse(file);
    // Files archive.org keeps private answer 403.
    return result.success && !isPrivate(result.data.private) ? [result.data] : [];
  });
  const reviews = parsed.data.reviews.flatMap((review) => {
    const stars = Number.parseFloat(String(Review.safeParse(review).data?.stars));
    return Number.isFinite(stars) ? [stars] : [];
  });
  const type = collections.some((c) => PODCAST_COLLECTIONS.includes(c)) ? 'podcast' : 'audiobook';
  return { metadata, type, files, reviews };
}

const isMp3 = (file: ArchiveFile) => /\bMP3$/i.test(file.format ?? '');

// Lower is better: archive.org's 64 kb copy streams well, then the uploaded file itself.
function rank(file: ArchiveFile): number {
  if (file.format === '64Kbps MP3') return 0;
  if (file.source === 'original') return 1;
  if (file.format === 'VBR MP3') return 2;
  return 3;
}

export type AudioFile = StreamPart & { name: string; title: string };

const BITRATE = /[ _.-]?(\d{2,3}) ?kb(?:ps)?(?=\.[^./]+$)/i;

/** A file name without a bitrate before its extension: `ep01_128kb.mp3` → `ep01.mp3`. */
export function stemOf(name: string): string {
  return name.replace(BITRATE, '').toLowerCase();
}

/** The bitrate a name carries, such as 64 for `ep01_64kb.mp3`; lower streams better. */
const kbOf = (name: string) => Number(BITRATE.exec(name)?.[1] ?? 1000);

/**
 * One MP3 per recording, in play order. Each upload can have several MP3 copies (64 kb, VBR),
 * all pointing at the same `original`; series often mix bitrates, so pick per recording.
 */
export function audioFiles(item: Item): AudioFile[] {
  const { identifier } = item.metadata;
  const byName = new Map(item.files.map((file) => [file.name, file]));
  const rootOf = (file: ArchiveFile): ArchiveFile => {
    let current = file;
    // Derivatives can be chained (flac → mp3 → 64 kb mp3); a few steps is plenty.
    for (let step = 0; step < 4 && current.original; step++) {
      const next = byName.get(current.original);
      if (!next || next === current) break;
      current = next;
    }
    return current;
  };

  // Keyed by the root's name without a bitrate, so `ep01_128kb.mp3` and `ep01_64kb.mp3`, uploaded
  // apart, are one recording.
  const best = new Map<string, [ArchiveFile, ArchiveFile]>();
  for (const file of item.files.filter(isMp3)) {
    const root = rootOf(file);
    const key = stemOf(root.name);
    const chosen = best.get(key)?.[1];
    if (
      !chosen ||
      rank(file) < rank(chosen) ||
      (rank(file) === rank(chosen) && kbOf(file.name) < kbOf(chosen.name))
    )
      best.set(key, [root, file]);
  }

  const recordings = [...best.values()];
  const tracks = new Map(
    recordings.map(([root, file]) => [file, trackNumber(file.track) ?? trackNumber(root.track)]),
  );
  const allTracked = recordings.every(([, file]) => tracks.get(file) !== undefined);
  recordings.sort(([rootA, a], [rootB, b]) =>
    allTracked
      ? (tracks.get(a) ?? 0) - (tracks.get(b) ?? 0) || naturalCompare(rootA.name, rootB.name)
      : naturalCompare(rootA.name, rootB.name),
  );

  return recordings.map(([root, file]): AudioFile => {
    const title = file.title?.trim() || root.title?.trim() || titleFromName(root.name);
    const part: AudioFile = {
      name: file.name,
      url: downloadUrl(identifier, file.name),
      durationMs: durationOf(file.length) ?? durationOf(root.length) ?? 0,
      title,
    };
    const size = trackNumber(file.size);
    if (size !== undefined && size >= 0) part.size = size;
    return part;
  });
}

/** `Dragnet_49-06-10_ep002_Homicide.mp3` → `Dragnet 49-06-10 ep002 Homicide`. */
export function titleFromName(name: string): string {
  const base = name.split('/').pop() ?? name;
  return (
    base
      .replace(/\.[^.]+$/, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || base
  );
}

/**
 * The broadcast date old-time radio files carry in their names, `49-06-10` or `490610`.
 * Undefined when there is none or it is not a real date. The century comes from `hints`: never
 * after the upload (`before`), the nearest to the item's own `year`, else 19yy from 1920 (when
 * radio began) and 20yy below that, so a recreation from 2005 isn't dated 1905.
 */
export function airDateOf(
  name: string,
  hints: { year?: number | undefined; before?: number | undefined } = {},
): Date | undefined {
  const match =
    name.match(/(?:^|[^0-9])(\d{2})-(\d{2})-(\d{2})(?![0-9])/) ??
    name.match(/(?:^|[_ ])(\d{2})(\d{2})(\d{2})(?=[_ .])/);
  if (!match) return undefined;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [number, number, number];
  const dates = [1900, 2000].flatMap((century) => {
    const date = new Date(Date.UTC(century + year, month - 1, day, 12));
    const real = date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    const past = date.getTime() <= (hints.before ?? Date.now());
    return real && past ? [date] : [];
  });
  const { year: near } = hints;
  if (near)
    return dates.sort(
      (a, b) => Math.abs(a.getUTCFullYear() - near) - Math.abs(b.getUTCFullYear() - near),
    )[0];
  return dates.find((date) => date.getUTCFullYear() >= 1920) ?? dates[0];
}

const IGNORED_SUBJECTS = new Set(['old time radio', 'otr', 'radio', 'audio', 'audiobook']);

function genresOf(item: Item, name: string): string[] {
  const named = name.toLowerCase();
  const subjects = [item.metadata.subject ?? []]
    .flat()
    .flatMap((subject) => subject.split(';'))
    .map((subject) => subject.trim())
    .filter(
      (subject) =>
        subject &&
        !IGNORED_SUBJECTS.has(subject.toLowerCase()) &&
        !named.includes(subject.toLowerCase()),
    );
  return unique(subjects).slice(0, 10);
}

export const link = (identifier: string) => `${ARCHIVE}/details/${encodeURIComponent(identifier)}`;

/** The meta for an item; `feed` is where this add-on serves a podcast item's episodes. */
export function toMeta(item: Item, feed: string): Meta | null {
  const { metadata } = item;
  const name = first(metadata.title);
  if (!name) return null;
  const identifier = metadata.identifier;
  const meta: Meta = {
    id: `${PREFIX}${identifier}`,
    type: item.type,
    name,
    cover: coverUrl(identifier),
    link: link(identifier),
    externalIds: { archive: identifier },
  };
  const author = first(metadata.creator);
  if (author) meta.author = author;
  const description = cleanDescription(first(metadata.description) ?? '');
  if (description) meta.description = description;
  const year = yearOf(metadata.year) ?? yearOf(metadata.date);
  if (year) meta.year = year;
  const language = first(metadata.language);
  if (language) meta.language = language;
  const genres = genresOf(item, `${name} ${author ?? ''}`);
  if (genres.length > 0) meta.genres = genres;

  const files = audioFiles(item);
  if (item.type === 'podcast') {
    if (files.length > 0) meta.feed = feed;
  } else if (files.length > 0) {
    let startMs = 0;
    meta.chapters = files.map((file): Chapter => {
      const chapter = { title: file.title, startMs };
      startMs += file.durationMs;
      return chapter;
    });
    if (files.every((file) => file.durationMs > 0)) meta.durationMs = startMs;
  }

  const reviews = item.reviews;
  const rating = ratingOf({
    avg_rating: reviews.reduce((sum, stars) => sum + stars, 0) / reviews.length,
    num_reviews: reviews.length,
  });
  if (rating !== undefined) meta.badges = { rating };
  return meta;
}

export function toStream(item: Item): Stream | null {
  const files = audioFiles(item);
  if (files.length === 0) return null;
  const parts = files.map(({ url, durationMs, title, size }): StreamPart => ({
    url,
    title,
    durationMs,
    ...(size === undefined ? {} : { size }),
  }));
  const stream: Stream = {
    sourceKey: `${PREFIX}${item.metadata.identifier}:mp3`,
    name: 'Internet Archive',
    mime: 'audio/mpeg',
    downloadable: true,
    parts,
  };
  const sizes = parts.map((part) => part.size);
  if (sizes.every((size) => size !== undefined))
    stream.size = sizes.reduce<number>((total, size) => total + (size ?? 0), 0);
  return stream;
}

const escapeXml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  );

// XML 1.0 refuses most control characters, even escaped.
const xmlText = (text: string) =>
  // eslint-disable-next-line no-control-regex
  escapeXml(text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''));

/** archive.org's `publicdate`, `2007-03-11 13:15:50` in UTC. */
function uploadedAt(item: Item): number {
  const raw = String(item.metadata.publicdate ?? '').trim();
  const parsed = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * An RSS feed of a podcast item's files, so the app can subscribe to an old radio series like any
 * podcast. Enclosures point straight at archive.org. Episodes are dated by their broadcast dates
 * when every file name has one; otherwise a second apart from the upload date, in file order, so
 * the app's newest-first list keeps the item's order.
 */
export function toFeed(item: Item, self: string): string | null {
  const name = first(item.metadata.title);
  if (!name) return null;
  const { identifier } = item.metadata;
  const files = audioFiles(item);
  const hints = {
    year: yearOf(item.metadata.year) ?? yearOf(item.metadata.date),
    before: uploadedAt(item) || undefined,
  };
  const airDates = files.map((file) => airDateOf(file.name, hints));
  const dated = airDates.every((date) => date !== undefined);
  // Without an upload date, the start of 2000 keeps the order without dating episodes to 1970.
  const base = uploadedAt(item) || Date.UTC(2000, 0, 1);

  const author = first(item.metadata.creator);
  const description = cleanDescription(first(item.metadata.description) ?? '');
  const licence = first(item.metadata.licenseurl);
  const channel = [
    `<title>${xmlText(name)}</title>`,
    `<link>${xmlText(link(identifier))}</link>`,
    `<description>${xmlText(description || name)}</description>`,
    `<atom:link href="${xmlText(self)}" rel="self" type="application/rss+xml"/>`,
    `<itunes:image href="${xmlText(coverUrl(identifier))}"/>`,
    `<image><url>${xmlText(coverUrl(identifier))}</url><title>${xmlText(name)}</title><link>${xmlText(link(identifier))}</link></image>`,
    author ? `<itunes:author>${xmlText(author)}</itunes:author>` : '',
    licence ? `<copyright>${xmlText(licence)}</copyright>` : '',
    `<generator>Lelap Internet Archive add-on</generator>`,
  ];
  const items = files.map((file, index) => {
    const published = dated ? (airDates[index] as Date) : new Date(base + index * 1000);
    return [
      '<item>',
      `<title>${xmlText(file.title)}</title>`,
      `<guid isPermaLink="false">${xmlText(`${PREFIX}${identifier}/${file.name}`)}</guid>`,
      `<enclosure url="${xmlText(file.url)}" length="${file.size ?? 0}" type="audio/mpeg"/>`,
      `<pubDate>${published.toUTCString()}</pubDate>`,
      file.durationMs > 0
        ? `<itunes:duration>${Math.round(file.durationMs / 1000)}</itunes:duration>`
        : '',
      `<itunes:episode>${index + 1}</itunes:episode>`,
      '</item>',
    ].join('');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    `<channel>${channel.join('')}${items.join('\n')}</channel>`,
    '</rss>',
  ].join('\n');
}
