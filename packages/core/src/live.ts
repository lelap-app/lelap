import { eq } from 'drizzle-orm';

import type { Db } from './db';
import { books } from './schema';

/**
 * A live stream (M154), such as a radio station: a book whose add-on stream says `live`. It keeps
 * no place, progress or finish, sends at most a `start` scrobble event, counts towards no stats or
 * history, and is never downloaded.
 */
export function isLiveBook(db: Db, bookId: string): boolean {
  return (
    db.select({ addonItem: books.addonItem }).from(books).where(eq(books.id, bookId)).get()
      ?.addonItem?.live === true
  );
}

/** The stream's own MIME type, for a player that can't tell HLS from its address. */
export function streamMime(db: Db, bookId: string): string | null {
  return (
    db.select({ addonItem: books.addonItem }).from(books).where(eq(books.id, bookId)).get()
      ?.addonItem?.mime ?? null
  );
}

const HLS_MIMES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl'];

/** An HLS playlist, by its MIME type or else its address (`.m3u8`). */
export function isHls(uri: string, mime?: string | null): boolean {
  if (mime) return HLS_MIMES.includes(mime.toLowerCase().split(';')[0]?.trim() ?? '');
  try {
    return new URL(uri).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return false;
  }
}

/**
 * The line under a station's name from its now-playing metadata: an ICY `StreamTitle` (usually
 * “Artist - Title”) or HLS ID3 frames. Null when there is nothing to show.
 */
export function nowPlayingLine(meta: {
  streamTitle?: string | null;
  title?: string | null;
  artist?: string | null;
}): string | null {
  const clean = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim() || null;
  const icy = clean(meta.streamTitle);
  if (icy && icy !== '-') return icy;
  const title = clean(meta.title);
  const artist = clean(meta.artist);
  if (title && artist) return `${artist} - ${title}`;
  return title ?? artist;
}
