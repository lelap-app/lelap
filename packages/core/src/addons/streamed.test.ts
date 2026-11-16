import type { Meta, Stream } from '@lelap/sdk';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { ROOT, scanned } from '../../test/files';
import { addBookmark, listBookmarks } from '../bookmarks';
import type { Db } from '../db';
import { applyScan, splitScanned, upsertRoot } from '../library/scan';
import { getBook, listBooks } from '../library/queries';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';
import { resumePoint, saveProgress } from '../progress';
import { bookFiles, books, progress } from '../schema';
import {
  addStreamedBook,
  findBookBySource,
  findStreamedBook,
  removeStreamedBook,
} from './streamed';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

const ADDON = 'https://addon.example/librivox/manifest.json';

const meta: Meta = {
  id: 'librivox:garden',
  type: 'audiobook',
  name: 'The Secret Garden',
  author: 'Frances Hodgson Burnett',
  cover: 'https://img.example/garden.jpg',
};

const parts = (count: number, sourceKey = 'librivox:garden:64kb'): Stream => ({
  sourceKey,
  name: 'LibriVox',
  parts: Array.from({ length: count }, (_, i) => ({
    url: `https://audio.example/garden_${i + 1}.mp3`,
    title: `Chapter ${i + 1}`,
    durationMs: 60_000,
  })),
});

const add = (db: Db, stream: Stream, item: Meta = meta, now = 100) =>
  addStreamedBook(db, { addonUrl: ADDON, meta: item, stream, now, newId });

describe('addStreamedBook', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('adds a streamed book with its parts and one chapter per part', () => {
    const bookId = add(db, parts(3));
    const detail = getBook(db, ME, bookId);
    expect(detail?.book).toMatchObject({
      title: 'The Secret Garden',
      author: 'Frances Hodgson Burnett',
      coverUrl: 'https://img.example/garden.jpg',
      source: 'addon',
      durationMs: 180_000,
      missing: false,
    });
    expect(detail?.files.map((f) => f.uri)).toEqual([
      'https://audio.example/garden_1.mp3',
      'https://audio.example/garden_2.mp3',
      'https://audio.example/garden_3.mp3',
    ]);
    expect(detail?.chapters).toEqual([
      { title: 'Chapter 1', startMs: 0 },
      { title: 'Chapter 2', startMs: 60_000 },
      { title: 'Chapter 3', startMs: 120_000 },
    ]);
    expect(listBooks(db, ME, 'recent')).toHaveLength(1);
  });

  it('adds a single-file stream with its own chapters', () => {
    const bookId = add(db, {
      sourceKey: 'one',
      name: 'Source',
      url: 'https://audio.example/garden.m4b',
      durationMs: 3_600_000,
      chapters: [
        { title: 'Opening', startMs: 0 },
        { title: 'Middle', startMs: 1_800_000 },
      ],
    });
    const detail = getBook(db, ME, bookId);
    expect(detail?.files).toHaveLength(1);
    expect(detail?.book.durationMs).toBe(3_600_000);
    expect(detail?.chapters.map((c) => c.title)).toEqual(['Opening', 'Middle']);
  });

  it('refreshes the same book and keeps the place in its part', () => {
    const bookId = add(db, parts(3));
    const location = getBook(db, ME, bookId)?.files[1]?.location ?? '';
    saveProgress(db, ME, { bookId, fileLocation: location, filePositionMs: 5_000, savedAt: 200 });

    expect(add(db, parts(4), meta, 300)).toBe(bookId);

    expect(getBook(db, ME, bookId)?.files).toHaveLength(4);
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 1, location, positionMs: 5_000 });
  });

  it('falls back to the book offset when the source changes', () => {
    const bookId = add(db, parts(3));
    const location = getBook(db, ME, bookId)?.files[1]?.location ?? '';
    saveProgress(db, ME, { bookId, fileLocation: location, filePositionMs: 5_000, savedAt: 200 });

    expect(add(db, parts(2, 'other-recording'), meta, 300)).toBe(bookId);

    const files = getBook(db, ME, bookId)?.files ?? [];
    expect(files.every((f) => f.location.startsWith('stream:other-recording:'))).toBe(true);
    expect(resumePoint(db, ME, bookId)).toMatchObject({ index: 1, positionMs: 5_000 });
  });

  it('finds the same book when another item plays the same recording', () => {
    const bookId = add(db, parts(2));
    const other: Meta = { ...meta, id: 'ol:OL1W', name: 'Secret Garden', cover: undefined };
    expect(findBookBySource(db, 'librivox:garden:64kb')).toBe(bookId);
    expect(add(db, parts(2), other, 300)).toBe(bookId);
    expect(findStreamedBook(db, 'audiobook', 'librivox:garden')).toBe(bookId);
    expect(findStreamedBook(db, 'audiobook', 'ol:OL2W')).toBeNull();
    expect(getBook(db, ME, bookId)?.book).toMatchObject({
      title: 'The Secret Garden',
      coverUrl: 'https://img.example/garden.jpg',
    });
  });
});

describe('streamed books next to a local folder', () => {
  it('are never marked missing or regrouped by a rescan', () => {
    const db = createTestDb();
    const bookId = add(db, parts(2));
    const location = getBook(db, ME, bookId)?.files[0]?.location ?? '';
    saveProgress(db, ME, { bookId, fileLocation: location, filePositionMs: 9_000, savedAt: 200 });
    addBookmark(db, ME, newId, {
      bookId,
      fileLocation: location,
      filePositionMs: 1_000,
      note: null,
      now: 200,
    });

    const rootId = upsertRoot(
      db,
      { uri: `content://${ROOT}`, name: 'Audiobooks', location: ROOT },
      300,
      newId,
    );
    const { listed, tags } = splitScanned([scanned('Novel/01.mp3')]);
    applyScan(db, {
      rootId,
      rootLocation: ROOT,
      listed,
      tags,
      folderCovers: new Map(),
      now: 300,
      newId,
    });
    // And a second scan in which the local book has gone.
    applyScan(db, {
      rootId,
      rootLocation: ROOT,
      listed: [],
      tags: new Map(),
      folderCovers: new Map(),
      now: 400,
      newId,
    });

    const streamed = db.select().from(books).where(eq(books.id, bookId)).get();
    expect(streamed?.missingSince).toBeNull();
    expect(
      db
        .select()
        .from(bookFiles)
        .where(eq(bookFiles.bookId, bookId))
        .all()
        .map((f) => f.missingSince),
    ).toEqual([null, null]);
    expect(resumePoint(db, ME, bookId)).toEqual({ index: 0, location, positionMs: 9_000 });
    expect(listBookmarks(db, ME, bookId)).toHaveLength(1);
  });
});

describe('removeStreamedBook', () => {
  it('removes a streamed book with its place', () => {
    const db = createTestDb();
    const bookId = add(db, parts(2));
    const location = getBook(db, ME, bookId)?.files[0]?.location ?? '';
    saveProgress(db, ME, { bookId, fileLocation: location, filePositionMs: 1, savedAt: 200 });

    expect(removeStreamedBook(db, bookId)).toBe(true);
    expect(db.select().from(books).all()).toHaveLength(0);
    expect(db.select().from(bookFiles).all()).toHaveLength(0);
    expect(db.select().from(progress).all()).toHaveLength(0);
  });

  it('leaves local books alone', () => {
    const db = createTestDb();
    const rootId = upsertRoot(
      db,
      { uri: `content://${ROOT}`, name: 'Audiobooks', location: ROOT },
      1,
      newId,
    );
    const { listed, tags } = splitScanned([scanned('Novel/01.mp3')]);
    applyScan(db, {
      rootId,
      rootLocation: ROOT,
      listed,
      tags,
      folderCovers: new Map(),
      now: 1,
      newId,
    });
    const local = db.select().from(books).get();
    expect(removeStreamedBook(db, local?.id ?? '')).toBe(false);
    expect(db.select().from(books).all()).toHaveLength(1);
  });
});
