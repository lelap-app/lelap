import { and, eq } from 'drizzle-orm';

import type { Db } from '../db';
import { bookFiles, downloads, episodes, subscriptions } from '../schema';
import { asArray, htmlToText, isNode, textOf, type XmlNode } from './xml';

/** One audio `podcast:alternateEnclosure`, at its first web address. */
export type FeedAlternate = {
  url: string;
  mime: string | null;
  /** Bytes; 0 when the feed gives none. */
  size: number;
  /** Bits per second, when the feed gives it. */
  bitrate: number | null;
  title: string | null;
  /** `podcast:integrity type="sri"`: one or more hashes such as `sha256-…`. */
  integrity: string | null;
  default: boolean;
};

const isHttp = (url: string) => /^https?:\/\//i.test(url);
const orNull = (text: string) => (text === '' ? null : text);

function positiveNumber(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Every audio alternate of an item, the one marked `default` first. Sources of other schemes
 * are skipped: the player streams over HTTP only. PGP signatures are not kept: there is no key
 * to check them against.
 */
export function alternatesOf(item: XmlNode): FeedAlternate[] {
  const list: FeedAlternate[] = [];
  for (const alt of asArray(item['podcast:alternateEnclosure']).filter(isNode)) {
    const type = textOf(alt['@_type']);
    if (!type.toLowerCase().startsWith('audio/')) continue;
    const url = asArray(alt['podcast:source'])
      .filter(isNode)
      .map((s) => textOf(s['@_uri']))
      .find(isHttp);
    if (!url || list.some((a) => a.url === url)) continue;
    const sri = asArray(alt['podcast:integrity'])
      .filter(isNode)
      .find((i) => textOf(i['@_type']).toLowerCase() === 'sri');
    list.push({
      url,
      mime: type,
      size: positiveNumber(textOf(alt['@_length'])) ?? 0,
      bitrate: positiveNumber(textOf(alt['@_bitrate'])),
      title: orNull(htmlToText(textOf(alt['@_title']))),
      integrity: sri ? orNull(textOf(sri['@_value']).trim()) : null,
      default: textOf(alt['@_default']) === 'true',
    });
  }
  return [...list.filter((a) => a.default), ...list.filter((a) => !a.default)];
}

/**
 * A file an episode can play. `key` names it the same way in every episode of a show, so a
 * choice made once holds for the next episode: `enclosure` for the feed's own file.
 */
export type AudioFile = Omit<FeedAlternate, 'default'> & { key: string };

export const ENCLOSURE_KEY = 'enclosure';
/** Always the smallest file the episode offers. */
export const SMALLEST_KEY = 'smallest';

const alternateKey = (a: FeedAlternate) =>
  `alt:${a.title ?? `${a.mime ?? ''} ${a.bitrate === null ? '' : Math.round(a.bitrate / 1000)}`}`;

/** The feed's own file first, then every other audio alternate. */
export function audioFilesOf(episode: {
  url: string;
  mime: string | null;
  size: number;
  extras: { alternates?: FeedAlternate[] } | null;
}): AudioFile[] {
  const alternates = episode.extras?.alternates ?? [];
  // The enclosure may also be listed as an alternate, with its hash and bitrate.
  const same = alternates.find((a) => a.url === episode.url);
  const files: AudioFile[] = [
    {
      url: episode.url,
      mime: episode.mime ?? same?.mime ?? null,
      size: episode.size || (same?.size ?? 0),
      bitrate: same?.bitrate ?? null,
      title: same?.title ?? null,
      integrity: same?.integrity ?? null,
      key: ENCLOSURE_KEY,
    },
  ];
  for (const a of alternates) {
    if (a.url === episode.url) continue;
    const key = alternateKey(a);
    if (files.some((f) => f.key === key)) continue;
    files.push({
      url: a.url,
      mime: a.mime,
      size: a.size,
      bitrate: a.bitrate,
      title: a.title,
      integrity: a.integrity,
      key,
    });
  }
  return files;
}

/** By size, else by bitrate when no file has a size; the first when neither is known. */
function smallest(files: AudioFile[]): AudioFile | undefined {
  const sized = files.filter((f) => f.size > 0);
  if (sized.length > 1) return sized.reduce((a, b) => (b.size < a.size ? b : a));
  const rated = files.filter((f) => f.bitrate !== null);
  if (rated.length > 1)
    return rated.reduce((a, b) => ((b.bitrate ?? 0) < (a.bitrate ?? 0) ? b : a));
  return files[0];
}

/**
 * The file to play. `choice` is the show's: null is automatic (the feed's own file, the
 * smallest on mobile data), `smallest`, or a file's key; a key this episode lacks is automatic.
 */
export function pickAudioFile(
  files: AudioFile[],
  choice: string | null,
  metered: boolean,
): AudioFile | undefined {
  const chosen = choice && choice !== SMALLEST_KEY ? files.find((f) => f.key === choice) : null;
  if (chosen) return chosen;
  if (choice === SMALLEST_KEY || metered) return smallest(files);
  return files[0];
}

const CODECS: [RegExp, string][] = [
  [/mpeg|mp3/, 'MP3'],
  [/opus/, 'Opus'],
  [/ogg|vorbis/, 'Ogg Vorbis'],
  [/aac|mp4|m4a/, 'AAC'],
  [/flac/, 'FLAC'],
  [/wav/, 'WAV'],
];

/** “MP3, 128 kbit/s”, or the feed's own title; empty when the feed says nothing about it. */
export function audioFileLabel(file: AudioFile): string {
  if (file.title) return file.title;
  const mime = file.mime?.toLowerCase() ?? '';
  const codec = CODECS.find(([pattern]) => pattern.test(mime))?.[1] ?? '';
  const rate = file.bitrate === null ? '' : `${Math.round(file.bitrate / 1000)} kbit/s`;
  return [codec, rate].filter((s) => s !== '').join(', ');
}

/** Which file every episode of a show plays, per profile; null is automatic. Syncs. */
export function setAudioChoice(
  db: Db,
  profileId: string,
  podcastId: string,
  choice: string | null,
  now: number,
): void {
  db.update(subscriptions)
    .set({ audioChoice: choice, updatedAt: now })
    .where(and(eq(subscriptions.profileId, profileId), eq(subscriptions.podcastId, podcastId)))
    .run();
}

function episodeFilesOfBook(db: Db, bookId: string) {
  const episode = db
    .select({
      podcastId: episodes.podcastId,
      url: episodes.url,
      mime: episodes.mime,
      size: episodes.size,
      extras: episodes.extras,
    })
    .from(episodes)
    .where(eq(episodes.bookId, bookId))
    .get();
  return episode ? { podcastId: episode.podcastId, files: audioFilesOf(episode) } : null;
}

/**
 * Points an episode's book at the file its show's choice and the connection call for. The book
 * keeps its ID and its file its location, so the place, bookmarks and what syncs stay. A book
 * with a download, done or on its way, keeps the file it downloads. Returns whether it changed.
 */
export function chooseEpisodeFile(
  db: Db,
  profileId: string,
  bookId: string,
  metered: boolean,
  now: number,
): boolean {
  const found = episodeFilesOfBook(db, bookId);
  if (!found) return false;
  const choice =
    db
      .select({ audioChoice: subscriptions.audioChoice })
      .from(subscriptions)
      .where(
        and(eq(subscriptions.profileId, profileId), eq(subscriptions.podcastId, found.podcastId)),
      )
      .get()?.audioChoice ?? null;
  const pick = pickAudioFile(found.files, choice, metered);
  if (!pick) return false;
  if (db.select({ id: downloads.bookId }).from(downloads).where(eq(downloads.bookId, bookId)).get())
    return false;
  const files = db
    .select({ id: bookFiles.id, uri: bookFiles.uri })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, bookId))
    .all();
  const file = files[0];
  if (!file || files.length !== 1 || file.uri === pick.url) return false;
  db.update(bookFiles)
    .set({ uri: pick.url, relPath: pick.url, size: pick.size, updatedAt: now })
    .where(eq(bookFiles.id, file.id))
    .run();
  return true;
}

/** The SRI hash the feed gives for the file at `url` of an episode's book, if any. */
export function episodeFileIntegrity(db: Db, bookId: string, url: string): string | null {
  return episodeFilesOfBook(db, bookId)?.files.find((f) => f.url === url)?.integrity ?? null;
}
