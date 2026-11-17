import type { Meta, Stream } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import { addStreamedBook } from './addons/streamed';
import { exportLibrary, importLibrary, parseBackup } from './backup';
import { getBook } from './library/queries';
import { createPlaylist, getTags, listPlaylists, setTags } from './organise';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { saveProgress } from './progress';
import { bookIdForKey } from './sync/keys';

let n = 0;
const newId = () => `b-${++n}`;

const meta: Meta = { id: 'librivox:garden', type: 'audiobook', name: 'The Secret Garden' };
const stream: Stream = {
  sourceKey: 'librivox:garden:64kb',
  name: 'LibriVox',
  parts: [1, 2].map((i) => ({
    url: `https://audio.example/g${i}.mp3`,
    title: `Chapter ${i}`,
    durationMs: 60_000,
  })),
};

describe('export and import', () => {
  it('moves a library to another device and merges by newest change', () => {
    const phone = createTestDb();
    const bookId = addStreamedBook(phone, {
      addonUrl: 'https://addon.example/manifest.json',
      meta,
      stream,
      now: 10,
      newId,
    });
    saveProgress(
      phone,
      ME,
      { bookId, fileLocation: 'stream:librivox:garden:64kb:1', filePositionMs: 5_000, savedAt: 20 },
      'app',
    );
    setTags(phone, ME, bookId, ['sleep'], 21);
    createPlaylist(phone, ME, newId, { name: 'Bedtime', rule: null }, 22);

    const text = JSON.stringify(exportLibrary(phone, 100));
    const laptop = createTestDb();
    const result = importLibrary(laptop, parseBackup(text), 200, newId);
    expect(result.changes).toBeGreaterThan(0);

    const there = bookIdForKey(laptop, 'addon:audiobook:librivox:garden') ?? '';
    expect(getBook(laptop, ME, there)?.book.title).toBe('The Secret Garden');
    expect(getTags(laptop, ME, there)).toEqual(['sleep']);
    expect(listPlaylists(laptop, ME).map((p) => p.name)).toEqual(['Bedtime']);

    // Importing the same file again changes nothing that is newer here.
    setTags(laptop, ME, there, ['classic'], 300);
    importLibrary(laptop, parseBackup(text), 400, newId);
    expect(getTags(laptop, ME, there)).toEqual(['classic']);
  });

  it('refuses files that are not exports', () => {
    expect(() => parseBackup('nope')).toThrow('not a Lelap export');
    expect(() => parseBackup('{"format":"other"}')).toThrow('not a Lelap export');
  });
});
