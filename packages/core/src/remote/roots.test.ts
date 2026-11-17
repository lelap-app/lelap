import { describe, expect, it } from 'vitest';

import { createTestDb } from '../../test/db';
import { listBooks } from '../library/queries';
import {
  addRemoteRoot,
  applyScan,
  type FileTags,
  listRoots,
  localRoot,
  remoteName,
  removeRemoteRoot,
  upsertRoot,
} from '../library/scan';
import { DEFAULT_PROFILE_ID as ME } from '../profiles';

let n = 0;
const newId = () => `id-${++n}`;

const webdav = {
  type: 'webdav' as const,
  url: 'https://nas.example.org/dav/Audiobooks/',
  username: 'me',
  password: 'secret',
};

const tags = (title: string, durationMs: number): FileTags => ({
  durationMs,
  title,
  album: 'Dune',
  artist: 'Frank Herbert',
  albumArtist: null,
  coverPath: null,
  chapters: [],
});

describe('library roots on servers', () => {
  it('keeps servers apart from the phone folder and turns their files into books', () => {
    const db = createTestDb();
    const rootId = addRemoteRoot(db, webdav, 1, newId);
    upsertRoot(
      db,
      { uri: 'content://tree', name: 'Audiobooks', location: 'primary:Audiobooks' },
      2,
      newId,
    );
    expect(listRoots(db)).toHaveLength(2);
    expect(localRoot(db)?.location).toBe('primary:Audiobooks');
    expect(remoteName(webdav)).toBe('nas.example.org/dav/Audiobooks');

    const listed = ['01.mp3', '02.mp3'].map((name, i) => ({
      location: `webdav:nas.example.org/dav/Audiobooks/Dune/${name}`,
      relPath: `Dune/${name}`,
      name,
      size: 10 + i,
      modifiedAt: 5,
      uri: `https://nas.example.org/dav/Audiobooks/Dune/${name}`,
    }));
    applyScan(db, {
      rootId,
      rootLocation: 'webdav:nas.example.org/dav/Audiobooks',
      listed,
      tags: new Map(listed.map((f, i) => [f.location, tags(`Part ${i + 1}`, 60_000)])),
      folderCovers: new Map(),
      now: 3,
      newId,
    });
    expect(listBooks(db, ME, 'title').map((b) => [b.title, b.durationMs])).toEqual([
      ['Dune', 120_000],
    ]);

    removeRemoteRoot(db, rootId);
    expect(listBooks(db, ME, 'title')).toEqual([]);
    expect(listRoots(db).map((r) => r.location)).toEqual(['primary:Audiobooks']);
  });
});
