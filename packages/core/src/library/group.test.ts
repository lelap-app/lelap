import { describe, expect, it } from 'vitest';

import { ROOT, scanned } from '../../test/files';
import { groupIntoBooks } from './group';

const group = (files: ReturnType<typeof scanned>[], covers = new Map<string, string>()) =>
  groupIntoBooks(ROOT, files, covers);

describe('groupIntoBooks', () => {
  it('makes a folder with one file a book titled from its album tag', () => {
    const books = group([
      scanned('Some Author - Some Title/book.mp3', { album: 'Some Title', artist: 'Some Author' }),
    ]);
    expect(books).toEqual([
      expect.objectContaining({
        location: `${ROOT}/Some Author - Some Title`,
        kind: 'folder',
        title: 'Some Title',
        author: 'Some Author',
      }),
    ]);
  });

  it('titles an untagged folder book with the whole folder name', () => {
    const [book] = group([scanned('Some Author - Some Title/book.mp3')]);
    expect(book?.title).toBe('Some Author - Some Title');
    expect(book?.author).toBeNull();
  });

  it('makes a folder of episodes one book in natural order', () => {
    const files = [];
    for (let s = 1; s <= 7; s++) {
      for (let e = 1; e <= 9; e++)
        files.push(scanned(`Show/Show.S0${s}E${e}.mp3`, { album: 'Show' }));
    }
    files.reverse();
    const books = group(files);
    expect(books).toHaveLength(1);
    expect(books[0]?.files.map((f) => f.name).slice(0, 2)).toEqual([
      'Show.S01E1.mp3',
      'Show.S01E2.mp3',
    ]);
    expect(books[0]?.files.at(-1)?.name).toBe('Show.S07E9.mp3');
  });

  it('uses the folder name when album tags disagree', () => {
    const [book] = group([
      scanned('My Show/a.S01E01.mp3', { album: 'Show' }),
      scanned('My Show/a.S07E01.mp3', { album: 'Show 7' }),
    ]);
    expect(book?.title).toBe('My Show');
  });

  it('splits a folder of chaptered files into one book per file', () => {
    const chapters = [{ title: 'One', startMs: 0 }];
    const books = group([
      scanned('Author/First.m4b', { chapters, album: 'First' }),
      scanned('Author/Second.m4b', { chapters, album: 'Second' }),
      scanned('Author/Third.m4b', { chapters, album: 'Third' }),
    ]);
    expect(books.map((b) => [b.kind, b.title, b.author])).toEqual([
      ['file', 'First', 'Author'],
      ['file', 'Second', 'Author'],
      ['file', 'Third', 'Author'],
    ]);
    expect(books[0]?.location).toBe(`${ROOT}/Author/First.m4b`);
  });

  it('keeps a folder of unchaptered m4b files as one book', () => {
    const books = group([
      scanned('Book/Part 1.m4b'),
      scanned('Book/Part 2.m4b'),
      scanned('Book/Part 3.m4b'),
    ]);
    expect(books).toHaveLength(1);
  });

  it('merges disc folders into one book at their parent', () => {
    const books = group([
      scanned('Book/CD 2/01.mp3'),
      scanned('Book/CD 1/02.mp3'),
      scanned('Book/CD 1/01.mp3'),
    ]);
    expect(books).toHaveLength(1);
    expect(books[0]?.location).toBe(`${ROOT}/Book`);
    expect(books[0]?.title).toBe('Book');
    expect(books[0]?.files.map((f) => f.relPath)).toEqual([
      'Book/CD 1/01.mp3',
      'Book/CD 1/02.mp3',
      'Book/CD 2/01.mp3',
    ]);
  });

  it('makes a loose file in the root a file book', () => {
    expect(group([scanned('Loose.mp3')])).toEqual([
      expect.objectContaining({
        kind: 'file',
        title: 'Loose',
        author: null,
        location: `${ROOT}/Loose.mp3`,
      }),
    ]);
  });

  it('takes the author from the folder above the book', () => {
    const [book] = group([scanned('Writer/Novel/01.mp3')]);
    expect(book?.author).toBe('Writer');
  });

  it('ignores non-audio files and folders without audio', () => {
    const books = group([
      scanned('Stats/.nomedia'),
      scanned('Stats/stats.xml'),
      scanned('Book/position.dat'),
      scanned('Book/cover.jpg'),
      scanned('Book/book.mp3'),
    ]);
    expect(books).toHaveLength(1);
    expect(books[0]?.files.map((f) => f.name)).toEqual(['book.mp3']);
  });

  it('keeps a folder with .nomedia and audio', () => {
    expect(group([scanned('Hidden/.nomedia'), scanned('Hidden/book.mp3')])).toHaveLength(1);
  });

  it('leaves out Lelap’s own downloads inside the library folder', () => {
    const books = group([
      scanned('Lelap/.nomedia'),
      scanned('Lelap/.lelap-downloads'),
      scanned('Lelap/0193f7a2/001.mp3'),
      scanned('Lelapsing/book.mp3'),
    ]);
    expect(books.map((b) => b.title)).toEqual(['Lelapsing']);
  });

  it('prefers an embedded cover, then the folder cover', () => {
    const covers = new Map([[`${ROOT}/Book`, '/covers/folder.jpg']]);
    expect(group([scanned('Book/a.mp3')], covers)[0]?.coverPath).toBe('/covers/folder.jpg');
    expect(
      group([scanned('Book/a.mp3', { coverPath: '/covers/a.jpg' })], covers)[0]?.coverPath,
    ).toBe('/covers/a.jpg');
  });
});
