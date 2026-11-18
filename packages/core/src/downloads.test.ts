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
  localFileUri,
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
    // A Subsonic stream address has no extension; the file's own name has.
    expect(partFileName(2, 'https://music.example/rest/stream', 'Book/03 Part.FLAC')).toBe(
      '003.flac',
    );
    expect(partFileName(2, 'https://music.example/rest/stream', 'notes')).toBe('003.audio');
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
        { url: 'https://audio.example/garden_01.mp3', name: '001.mp3', size: 1000, rootId: null },
        {
          url: 'https://audio.example/garden_02.mp3?x=1',
          name: '002.mp3',
          size: 2000,
          rootId: null,
        },
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

  it('follows files to a chosen folder, streams while it is gone and picks them up again', () => {
    const bookId = add(db);
    requestDownload(db, planDownload(db, bookId), meta, 10);
    const done = { state: 'done' as const, files: ['001.mp3', '002.mp3'], cover: 'cover.jpg' };
    applyDownloadStatuses(db, DIR, [status(bookId, done)], 20);

    const card = 'content://com.android.externalstorage.documents/tree/1A2B-3C4D%3A/document';
    const paths = {
      '001.mp3': `${card}/1A2B-3C4D%3ALelap%2F${bookId}%2F001.mp3`,
      '002.mp3': `${card}/1A2B-3C4D%3ALelap%2F${bookId}%2F002.mp3`,
      'cover.jpg': `${card}/1A2B-3C4D%3ALelap%2F${bookId}%2Fcover.jpg`,
    };
    // Moved to the SD card.
    expect(applyDownloadStatuses(db, DIR, [status(bookId, { ...done, paths })], 30)).toEqual({
      changed: [bookId],
      orphans: [],
    });
    let detail = getBook(db, ME, bookId);
    expect(detail?.files.map((f) => f.downloadPath)).toEqual([paths['001.mp3'], paths['002.mp3']]);
    expect(detail?.book.coverPath).toBe(paths['cover.jpg']);
    expect(
      applyDownloadStatuses(db, DIR, [status(bookId, { ...done, paths })], 35).changed,
    ).toEqual([]);

    // The card is taken out: the book streams, and stays downloaded.
    const out = status(bookId, { state: 'stopped', unavailable: true });
    expect(applyDownloadStatuses(db, DIR, [out], 40).changed).toEqual([bookId]);
    detail = getBook(db, ME, bookId);
    expect(detail?.files.map((f) => f.downloadPath)).toEqual([null, null]);
    expect(detail?.book.coverPath).toBeNull();
    expect(getDownload(db, bookId)?.state).toBe('done');
    expect(applyDownloadStatuses(db, DIR, [out], 45).changed).toEqual([]);

    // Back in: the files are found again.
    expect(
      applyDownloadStatuses(db, DIR, [status(bookId, { ...done, paths })], 50).changed,
    ).toEqual([bookId]);
    expect(getBook(db, ME, bookId)?.files.map((f) => f.downloadPath)).toEqual([
      paths['001.mp3'],
      paths['002.mp3'],
    ]);
  });

  it('shows why a download into a missing folder failed', () => {
    const bookId = add(db);
    requestDownload(db, planDownload(db, bookId), meta, 10);
    const error = 'The download folder can’t be reached.';
    applyDownloadStatuses(
      db,
      DIR,
      [status(bookId, { state: 'failed', unavailable: true, error })],
      20,
    );
    expect(getDownload(db, bookId)).toMatchObject({ state: 'failed', error });
  });

  it('never deletes a download it cannot see', () => {
    const fold = applyDownloadStatuses(
      db,
      DIR,
      [status('gone', { unavailable: true }), status('stale', {})],
      10,
    );
    expect(fold.orphans).toEqual(['stale']);
  });

  it('turns paths into URIs the player reads', () => {
    expect(localFileUri('/data/no_backup/downloads/b/001.mp3')).toBe(
      'file:///data/no_backup/downloads/b/001.mp3',
    );
    expect(localFileUri('content://tree/doc')).toBe('content://tree/doc');
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

  it('fails a queued download whose job is gone, after a minute’s grace', () => {
    const bookId = add(db);
    requestDownload(db, planDownload(db, bookId), meta, 10);
    expect(applyDownloadStatuses(db, DIR, [], 30_000).changed).toEqual([]);
    expect(getDownload(db, bookId)?.state).toBe('queued');
    expect(applyDownloadStatuses(db, DIR, [], 70_000).changed).toEqual([bookId]);
    expect(getDownload(db, bookId)).toMatchObject({
      state: 'failed',
      error: 'The download stopped.',
    });
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
