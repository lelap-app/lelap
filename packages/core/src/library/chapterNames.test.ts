import { afterEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { seedBook } from '../../test/seed';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { chapters } from '../schema';
import { chapterTitleAt } from './bookFiles';
import { chapterTitle, namedChapters, setChapterNames } from './chapterNames';
import { setOwnChapters } from './ownChapters';
import { getBook, saveFoundChapters } from './queries';

const english = { chapter: (n: number) => `Chapter ${n}`, part: (n: number) => `Part ${n}` };
const malay = { chapter: (n: number) => `Bab ${n}`, part: (n: number) => `Bahagian ${n}` };

afterEach(() => setChapterNames(english));

describe('chapter names', () => {
  it('name an untitled chapter by its place, in the language current when it shows', () => {
    expect(chapterTitle('Prologue', 0)).toBe('Prologue');
    expect(chapterTitle(' ', 2)).toBe('Chapter 3');
    expect(chapterTitle('', 2, true)).toBe('Part 3');
    setChapterNames(malay);
    expect(
      namedChapters([
        { title: 'Prologue', startMs: 0 },
        { title: '', startMs: 5 },
      ]),
    ).toEqual([
      { title: 'Prologue', startMs: 0 },
      { title: 'Bab 2', startMs: 5 },
    ]);
  });

  it('show a shared book’s untitled chapters in each profile’s language', () => {
    const db = createTestDb();
    const bookId = seedBook(db, 'Novel', [{ location: 'n/01.mp3', durationMs: 9_000 }]);
    db.insert(chapters)
      .values(
        ['Opening', '', ''].map((title, idx) => ({
          id: `c${idx}`,
          bookId,
          idx,
          title,
          startMs: idx * 1000,
          updatedAt: 0,
        })),
      )
      .run();
    expect(getBook(db, ME, bookId)?.chapters.map((c) => c.title)).toEqual([
      'Opening',
      'Chapter 2',
      'Chapter 3',
    ]);
    setChapterNames(malay);
    expect(getBook(db, ME, bookId)?.chapters.map((c) => c.title)).toEqual([
      'Opening',
      'Bab 2',
      'Bab 3',
    ]);
    expect(chapterTitleAt(db, bookId, 2_500, ME)).toBe('Bab 3');

    // Saved unchanged from the editor, untitled ones and all: still the book's own.
    setOwnChapters(
      db,
      ME,
      bookId,
      ['Opening', '', ''].map((title, i) => ({ title, startMs: i * 1000 })),
      9_000,
      1,
    );
    expect(getBook(db, ME, bookId)?.ownChapters).toBe(false);
  });

  it('call chapters found from silences parts', () => {
    const db = createTestDb();
    const bookId = seedBook(db, 'Lecture', [{ location: 'l/01.mp3', durationMs: 9_000 }]);
    let n = 0;
    saveFoundChapters(
      db,
      bookId,
      [
        { title: '', startMs: 0 },
        { title: '', startMs: 4_000 },
      ],
      1,
      () => `f${++n}`,
    );
    expect(getBook(db, ME, bookId)?.chapters.map((c) => c.title)).toEqual(['Part 1', 'Part 2']);
    expect(chapterTitleAt(db, bookId, 5_000)).toBe('Part 2');
  });
});
