import type { StoredChapter } from '../schema';

// Untitled chapters are saved empty and named where they show (M99): the library is shared by
// every profile, so a name saved in one profile's language would show in it for all of them.

export type ChapterNames = {
  /** `Chapter 3`, for an untitled chapter from tags, a feed, a server or an add-on. */
  chapter: (n: number) => string;
  /** `Part 3`, for one found from silences. */
  part: (n: number) => string;
};

const ENGLISH: ChapterNames = { chapter: (n) => `Chapter ${n}`, part: (n) => `Part ${n}` };
let names: ChapterNames = ENGLISH;

/** The app hands over its names once, in whatever language is current when they are called. */
export function setChapterNames(next: ChapterNames): void {
  names = next;
}

/** The title to show for the chapter at [index] (from 0): its own, or a name in the language. */
export function chapterTitle(title: string, index: number, found = false): string {
  if (title.trim() !== '') return title;
  return found ? names.part(index + 1) : names.chapter(index + 1);
}

/** The chapters with every untitled one named, ready to show. */
export function namedChapters<T extends StoredChapter & { found?: boolean }>(
  list: readonly T[],
): T[] {
  return list.map((c, i) =>
    c.title.trim() === '' ? { ...c, title: chapterTitle(c.title, i, c.found) } : c,
  );
}
