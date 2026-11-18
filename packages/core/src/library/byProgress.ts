import { compareNatural } from './files';
import type { LibraryBook } from './queries';

export type ListeningStatus = 'inProgress' | 'notStarted' | 'finished';

type StatusFields = Pick<LibraryBook, 'finishedAt' | 'bookPositionMs' | 'lastPlayedAt'>;

/**
 * Where a book or episode stands for this profile. Marked finished wins, even when it was played
 * again afterwards; a place in it or a time it was played makes it started. Smart lists and the
 * Library's groups both read this, so they never disagree.
 */
export const listeningStatus = (book: StatusFields): ListeningStatus =>
  book.finishedAt !== null
    ? 'finished'
    : book.bookPositionMs > 0 || book.lastPlayedAt !== null
      ? 'inProgress'
      : 'notStarted';

/** The Library's default view (M79): three groups, each in its own order. */
export type ProgressGroups = Record<ListeningStatus, LibraryBook[]>;

const newest = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1);

const ORDER: Record<ListeningStatus, (a: LibraryBook, b: LibraryBook) => number> = {
  // A place without a play time (imported progress) comes after everything played.
  inProgress: (a, b) =>
    newest(a.lastPlayedAt, b.lastPlayedAt) ||
    b.addedAt - a.addedAt ||
    compareNatural(a.title, b.title),
  notStarted: (a, b) => b.addedAt - a.addedAt || compareNatural(a.title, b.title),
  finished: (a, b) =>
    newest(a.finishedAt, b.finishedAt) ||
    newest(a.lastPlayedAt, b.lastPlayedAt) ||
    compareNatural(a.title, b.title),
};

/** Splits books into In progress, Not started and Finished, each sorted for its group. */
export function groupByProgress(list: readonly LibraryBook[]): ProgressGroups {
  const groups: ProgressGroups = { inProgress: [], notStarted: [], finished: [] };
  for (const book of list) groups[listeningStatus(book)].push(book);
  for (const status of Object.keys(groups) as ListeningStatus[]) {
    groups[status].sort(ORDER[status]);
  }
  return groups;
}
