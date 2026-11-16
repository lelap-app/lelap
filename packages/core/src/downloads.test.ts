import type { Meta, Stream } from '@lelap/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { seedBook } from '../test/seed';
import { addStreamedBook, removeStreamedBook } from './addons/streamed';
import type { Db } from './db';
import {
  applyDownloadStatuses,
  coverFileName,
  downloadSnapshot,
  getDownload,
  listDownloads,
  type NativeDownloadStatus,
  partFileName,
  planDownload,
  removeDownload,
  requestDownload,
} from './downloads';
import { getBook, listBooks } from './library/queries';
import { DEFAULT_PROFILE_ID as ME } from './profiles';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

const DIR = '/data/no_backup/downloads';

const meta: Meta = {
  id: 'librivox:garden',
  type: 'audiobook',
  name: 'The Secret Garden',
  cover: 'https://img.example/garden.jpg',
  description: 'A girl finds a locked garden.',
};

const stream = (extra: Partial<Stream> = {}): Stream => ({
  sourceKey: 'librivox:garden:64kb',
  name: 'LibriVox',
  parts: [
    { url: 'https://audio.example/garden_01.mp3', durationMs: 60_000, size: 1000 },
    { url: 'https://audio.example/garden_02.mp3?x=1', durationMs: 60_000, size: 2000 },
  ],
  ...extra,
});

const add = (db: Db, s: Stream = stream()) =>
  addStreamedBook(db, {
    addonUrl: 'https://addon.example/manifest.json',
    meta,
    stream: s,
    now: 1,
    newId,
  });

const status = (bookId: string, extra: Partial<NativeDownloadStatus>): NativeDownloadStatus => ({
  bookId,
  state: 'running',
  bytesDone: 0,
  bytesTotal: 3000,
  files: [],
  cover: null,
  error: null,
  ...extra,
});

describe('file names', () => {
  it('numbers parts and keeps the extension of the URL path', () => {
    expect(partFileName(0, 'https://a.example/x/Part One.MP3?token=1')).toBe('001.mp3');
    expect(partFileName(41, 'https://a.example/stream')).toBe('042.audio');
    expect(partFileName(2, 'not a url.m4b')).toBe('003.m4b');
    expect(coverFileName('https://img.example/c.png')).toBe('cover.png');
    expect(coverFileName('https://archive.org/services/img/garden')).toBe('cover.jpg');
  });
});

describe('downloads', () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it('plans the parts and the cover of a streamed book', () => {
    const bookId = add(db);
    expect(planDownload(db, bookId)).toEqual({
      bookId,
      title: 'The Secret Garden',
      files: [
        { url: 'https://audio.example/garden_01.mp3', name: '001.mp3', size: 1000 },
        { url: 'https://audio.example/garden_02.mp3?x=1', name: '002.mp3', size: 2000 },
      ],
      cover: { url: 'https://img.example/garden.jpg', name: 'cover.jpg' },
      bytesTotal: 3000,
    });
  });

  it('refuses local books and streams that may not be downloaded', () => {
    const local = seedBook(db, 'primary:Audiobooks/Dune', [{ location: 'a', durationMs: 1 }]);
    expect(() => planDownload(db, local)).toThrow('already on the phone');
    const locked = add(db, stream({ downloadable: false }));
    expect(() => planDownload(db, locked)).toThrow('does not allow downloads');
  });

  it('plays finished parts from the phone and keeps the cover and snapshot', () => {
    const bookId = add(db);
    requestDownload(db, planDownload(db, bookId), meta, 10);
    expect(getDownload(db, bookId)?.state).toBe('queued');

    // Half done: nothing changes until the worker reports the whole book.
    applyDownloadStatuses(db, DIR, [status(bookId, { files: ['001.mp3'] })], 20);
    expect(getBook(db, ME, bookId)?.files.map((f) => f.downloadPath)).toEqual([null, null]);

    const fold = applyDownloadStatuses(
      db,
      DIR,
      [status(bookId, { state: 'done', files: ['001.mp3', '002.mp3'], cover: 'cover.jpg' })],
      30,
    );
    expect(fold).toEqual({ changed: [bookId], orphans: [] });
    const detail = getBook(db, ME, bookId);
    expect(detail?.files.map((f) => f.downloadPath)).toEqual([
      `${DIR}/${bookId}/001.mp3`,
      `${DIR}/${bookId}/002.mp3`,
    ]);
    expect(detail?.book.coverPath).toBe(`${DIR}/${bookId}/cover.jpg`);
    expect(detail?.book.downloaded).toBe(true);
    expect(getDownload(db, bookId)).toMatchObject({ state: 'done', completedAt: 30 });
    expect(downloadSnapshot(db, bookId)?.description).toBe('A girl finds a locked garden.');

    // Playing it again from the item page refreshes the book but keeps the downloaded cover.
    add(db);
    expect(getBook(db, ME, bookId)?.book.coverPath).toBe(`${DIR}/${bookId}/cover.jpg`);
    // A second report changes nothing.
    expect(applyDownloadStatuses(db, DIR, [status(bookId, { state: 'done' })], 40).changed).toEqual(
      [],
    );
  });

  it('records failures and clears them when the worker runs again', () => {
    const bookId = add(db);
    requestDownload(db, planDownload(db, bookId), meta, 10);
    applyDownloadStatuses(db, DIR, [status(bookId, { state: 'failed', error: 'HTTP 404' })], 20);
    expect(getDownload(db, bookId)).toMatchObject({ state: 'failed', error: 'HTTP 404' });
    applyDownloadStatuses(db, DIR, [status(bookId, { state: 'stopped' })], 25);
    expect(getDownload(db, bookId)?.error).toBe('The download stopped.');
    applyDownloadStatuses(db, DIR, [status(bookId, { state: 'waiting' })], 30);
    expect(getDownload(db, bookId)).toMatchObject({ state: 'queued', error: null });
  });

  it('keeps the snapshot when a retry has no meta', () => {
    const bookId = add(db);
    requestDownload(db, planDownload(db, bookId), meta, 10);
    requestDownload(db, planDownload(db, bookId), null, 20);
    expect(downloadSnapshot(db, bookId)?.name).toBe('The Secret Garden');
  });

  it('reports folders on disk that the database does not know', () => {
    expect(applyDownloadStatuses(db, DIR, [status('gone', {})], 1).orphans).toEqual(['gone']);
  });

  it('streams again after the download is removed', () => {
    const bookId = add(db);
    requestDownload(db, planDownload(db, bookId), meta, 10);
    applyDownloadStatuses(
      db,
      DIR,
      [status(bookId, { state: 'done', files: ['001.mp3', '002.mp3'], cover: 'cover.jpg' })],
      20,
    );
    removeDownload(db, bookId, 30);
    const detail = getBook(db, ME, bookId);
    expect(detail?.files.map((f) => f.downloadPath)).toEqual([null, null]);
    expect(detail?.book).toMatchObject({ coverPath: null, downloaded: false });
    expect(listDownloads(db)).toEqual([]);
  });

  it('goes with its book when the book is removed from the library', () => {
    const bookId = add(db);
    requestDownload(db, planDownload(db, bookId), meta, 10);
    removeStreamedBook(db, bookId);
    expect(listDownloads(db)).toEqual([]);
    expect(listBooks(db, ME, 'recent')).toEqual([]);
  });
});
