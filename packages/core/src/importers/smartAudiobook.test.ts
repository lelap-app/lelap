import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { seedBook } from '../../test/seed';
import type { Db } from '../db';
import { listAllBooks } from '../library/queries';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { resumePoint, saveProgress } from '../progress';
import { readJavaObject } from './javaSerial';
import { applySmartAudiobook, parseSabpPosition, type SabpFound } from './smartAudiobook';

// The fixtures are real position files with the file names replaced.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url)));

const HOUR = 3_600_000;

describe('Smart AudioBook Player', () => {
  let db: Db;
  let started: string;
  let finished: string;
  const found = (): SabpFound[] => [
    {
      location: 'primary:Audiobooks/Series/position.sabp.dat',
      book: parseSabpPosition(fixture('sabp-started.dat')),
    },
    {
      location: 'primary:Audiobooks/Single/position.sabp.dat',
      book: parseSabpPosition(fixture('sabp-finished.dat')),
    },
    {
      location: 'primary:Audiobooks/Elsewhere/position.sabp.dat',
      book: { ...parseSabpPosition(fixture('sabp-started.dat')), fileName: 'Other.mp3' },
    },
  ];

  beforeEach(() => {
    db = createTestDb();
    started = seedBook(
      db,
      'primary:Audiobooks/Series',
      Array.from({ length: 8 }, (_, i) => ({
        location: `primary:Audiobooks/Series/Part 0${i}.mp3`,
        durationMs: HOUR,
      })),
    );
    finished = seedBook(db, 'primary:Audiobooks/Single', [
      { location: 'primary:Audiobooks/Single/Whole book.mp3', durationMs: 8 * HOUR },
    ]);
  });

  it('reads the serialized position', () => {
    expect(parseSabpPosition(fixture('sabp-started.dat'))).toEqual({
      fileName: 'Part 07.mp3',
      filePositionMs: 6_000,
      bookPositionMs: 49_062_000,
      durationMs: 100_155_000,
      lastPlayedAt: 1_777_141_089_192,
      state: 'Started',
    });
    expect(parseSabpPosition(fixture('sabp-finished.dat'))).toMatchObject({
      fileName: 'Whole book.mp3',
      state: 'Finished',
    });
  });

  it('reads non-ASCII file names (Java modified UTF-8)', () => {
    const bytes = fixture('sabp-started.dat');
    const old = new TextEncoder().encode('Part 07.mp3');
    const at = bytes.findIndex((_, i) => old.every((b, j) => bytes[i + j] === b));
    // "Del 7 – Ø 😀.mp3": ø in two bytes, the dash in three, the emoji as two 3-byte surrogates.
    const name = [
      0x44, 0x65, 0x6c, 0x20, 0x37, 0x20, 0xe2, 0x80, 0x93, 0x20, 0xc3, 0x98, 0x20, 0xed, 0xa0,
      0xbd, 0xed, 0xb8, 0x80, 0x2e, 0x6d, 0x70, 0x33,
    ];
    const patched = new Uint8Array([
      ...bytes.subarray(0, at - 2),
      0,
      name.length,
      ...name,
      ...bytes.subarray(at + old.length),
    ]);
    expect(parseSabpPosition(patched).fileName).toBe('Del 7 – Ø 😀.mp3');
  });

  it('rejects other files', () => {
    expect(() => parseSabpPosition(new TextEncoder().encode('<xml/>'))).toThrow('Java');
    const object = readJavaObject(fixture('sabp-started.dat'));
    expect(object.fields.get('mBookState')).toEqual({
      className: 'ak.alizandro.smartaudiobookplayer.BookData$BookState',
      constant: 'Started',
    });
  });

  it('carries places and finished marks to the books in the same folders', () => {
    const result = applySmartAudiobook(db, ME, found(), 5_000);
    expect(result.matched).toBe(2);
    expect(result.skipped).toEqual([
      { item: 'Elsewhere', reason: 'Not in your library; look for new files first' },
    ]);
    expect(resumePoint(db, ME, started)).toEqual({
      index: 7,
      location: 'primary:Audiobooks/Series/Part 07.mp3',
      positionMs: 6_000,
    });
    const books = new Map(listAllBooks(db, ME).map((b) => [b.id, b]));
    expect(books.get(started)?.bookPositionMs).toBe(7 * HOUR + 6_000);
    expect(books.get(finished)?.finishedAt).toBe(1_793_258_591_970);

    // Importing again changes nothing.
    expect(applySmartAudiobook(db, ME, found(), 6_000).matched).toBe(0);
  });

  it('keeps a place Lelap saved later', () => {
    saveProgress(
      db,
      ME,
      {
        bookId: started,
        fileLocation: 'primary:Audiobooks/Series/Part 02.mp3',
        filePositionMs: 1_000,
        savedAt: 1_800_000_000_000,
      },
      'app',
    );
    applySmartAudiobook(db, ME, found(), 5_000);
    expect(resumePoint(db, ME, started).location).toBe('primary:Audiobooks/Series/Part 02.mp3');
  });
});
