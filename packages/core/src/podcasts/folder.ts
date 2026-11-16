import { and, asc, eq } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { setFinished } from '../library/queries';
import { saveProgress } from '../progress';
import { bookFiles, episodes, progress } from '../schema';
import { episodeBook } from './repository';

type LocalFile = { location: string; name: string; title: string | null };
type FeedItem = { id: string; title: string; season: number | null; number: number | null };

const CODE = /\bS(\d{1,3})\s*E(\d{1,4})\b|\bE(?:p(?:isode)?)?\.?\s*(\d{1,4})\b/i;

/** `S04E01` → season 4, episode 1; `E12` or `Episode 12` → episode 12. */
export function episodeCode(name: string): { season: number | null; number: number } | null {
  const m = CODE.exec(name);
  if (!m) return null;
  if (m[1] && m[2]) return { season: Number(m[1]), number: Number(m[2]) };
  return m[3] ? { season: null, number: Number(m[3]) } : null;
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '')
    .replace(/\bs\d+\s*e\d+\b|\bep?\.?\s*\d+\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Pairs the files of a local podcast folder with a feed's episodes: by season and episode number
 * first, then by title. Each episode is used once.
 */
export function matchFiles(files: LocalFile[], items: FeedItem[]): Map<string, string> {
  const matches = new Map<string, string>();
  const used = new Set<string>();
  for (const file of files) {
    const code = episodeCode(file.name) ?? (file.title ? episodeCode(file.title) : null);
    const byCode = code
      ? items.find(
          (e) =>
            !used.has(e.id) &&
            e.number === code.number &&
            (code.season === null || e.season === null || e.season === code.season),
        )
      : undefined;
    const names = [file.title, file.name].filter((t): t is string => !!t).map(normalize);
    const byTitle = items.find((e) => {
      if (used.has(e.id)) return false;
      const title = normalize(e.title);
      return (
        title.length > 0 &&
        names.some(
          (n) =>
            n === title ||
            (n.length >= 8 && title.includes(n)) ||
            (title.length >= 8 && n.includes(title)),
        )
      );
    });
    const match = byCode ?? byTitle;
    if (match) {
      matches.set(file.location, match.id);
      used.add(match.id);
    }
  }
  return matches;
}

/**
 * Carries the place in a local podcast folder over to its feed: episodes of files before the one
 * being listened to are played, and that one keeps its position.
 */
export function carryFolderPlace(
  db: Db,
  profileId: string,
  localBookId: string,
  podcastId: string,
  now: number,
  newId: IdGenerator,
): { matched: number; played: number } {
  const files = db
    .select({ location: bookFiles.location, name: bookFiles.name, title: bookFiles.title })
    .from(bookFiles)
    .where(eq(bookFiles.bookId, localBookId))
    .orderBy(asc(bookFiles.idx))
    .all();
  const items = db
    .select({
      id: episodes.id,
      title: episodes.title,
      season: episodes.season,
      number: episodes.number,
    })
    .from(episodes)
    .where(eq(episodes.podcastId, podcastId))
    .all();
  const matches = matchFiles(files, items);
  const place = db
    .select({ location: progress.fileLocation, positionMs: progress.filePositionMs })
    .from(progress)
    .where(and(eq(progress.profileId, profileId), eq(progress.bookId, localBookId)))
    .get();
  const current = place ? files.findIndex((f) => f.location === place.location) : -1;

  let played = 0;
  for (const [index, file] of files.entries()) {
    const episodeId = matches.get(file.location);
    if (!episodeId || index > current) continue;
    const bookId = episodeBook(db, episodeId, now, newId);
    if (index < current) {
      setFinished(db, profileId, bookId, true, now);
      played++;
    } else if (place && place.positionMs > 0) {
      const location = db
        .select({ location: bookFiles.location })
        .from(bookFiles)
        .where(eq(bookFiles.bookId, bookId))
        .get()?.location;
      if (location) {
        saveProgress(
          db,
          profileId,
          { bookId, fileLocation: location, filePositionMs: place.positionMs, savedAt: now },
          'app',
        );
      }
    }
  }
  return { matched: matches.size, played };
}
