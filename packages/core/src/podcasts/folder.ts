import { and, asc, eq } from 'drizzle-orm';

import type { Db } from '../db';
import type { IdGenerator } from '../ids';
import { episodeCode } from '../library/episodeCode';
import { listFolderEpisodes, showsAsPodcast } from '../library/folderPodcast';
import { setFinished } from '../library/queries';
import { saveProgress } from '../progress';
import { bookFiles, episodes, progress } from '../schema';
import { episodeBook } from './repository';

export { episodeCode };

type LocalFile = { location: string; name: string; title: string | null };
type FeedItem = { id: string; title: string; season: number | null; number: number | null };

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
 * being listened to are played, and that one keeps its position. A folder shown as a podcast
 * carries each file's own mark and place instead (M158), since its one place says little.
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
  const marks = showsAsPodcast(db, profileId, localBookId)
    ? new Map(listFolderEpisodes(db, profileId, localBookId).map((e) => [e.location, e]))
    : null;
  const place = db
    .select({ location: progress.fileLocation, positionMs: progress.filePositionMs })
    .from(progress)
    .where(and(eq(progress.profileId, profileId), eq(progress.bookId, localBookId)))
    .get();
  const current = place ? files.findIndex((f) => f.location === place.location) : -1;

  // Played, or where it was left (0: nothing to carry).
  const stateOf = (index: number, location: string): 'played' | number => {
    if (marks) {
      const mark = marks.get(location);
      return mark?.status === 'played' ? 'played' : (mark?.positionMs ?? 0);
    }
    if (index < current) return 'played';
    return index === current ? (place?.positionMs ?? 0) : 0;
  };

  let played = 0;
  for (const [index, file] of files.entries()) {
    const episodeId = matches.get(file.location);
    const state = stateOf(index, file.location);
    if (!episodeId || state === 0) continue;
    const bookId = episodeBook(db, episodeId, now, newId);
    if (state === 'played') {
      setFinished(db, profileId, bookId, true, now);
      played++;
      continue;
    }
    const location = db
      .select({ location: bookFiles.location })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId))
      .get()?.location;
    if (location) {
      saveProgress(
        db,
        profileId,
        { bookId, fileLocation: location, filePositionMs: state, savedAt: now },
        'app',
      );
    }
  }
  return { matched: matches.size, played };
}
