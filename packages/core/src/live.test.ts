import type { Manifest, Meta, Stream } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/db';
import type { InstalledAddon } from './addons/client';
import { addStreamedBook } from './addons/streamed';
import { downloadAllowed } from './downloads';
import { continueListening, getBook, setFinished } from './library/queries';
import { isHls, isLiveBook, nowPlayingLine, streamMime } from './live';
import { DEFAULT_PROFILE_ID as ME } from './profiles';
import { saveProgress } from './progress';
import { scrobbleOutbox } from './schema';
import { enqueueScrobble } from './scrobble';
import { listeningRows, recordListening } from './stats';
import { finishFromPlayer } from './upNext';

let n = 0;
const newId = () => `id-${String(++n).padStart(6, '0')}`;

const station: Meta = {
  id: 'radio:bbc-world-service',
  type: 'episode',
  name: 'BBC World Service',
};

const liveStream = (extra: Partial<Stream> = {}): Stream =>
  ({
    sourceKey: 'radio:bbc-world-service:hls',
    name: 'Radio',
    url: 'https://radio.example/world/live.m3u8',
    mime: 'application/vnd.apple.mpegurl',
    downloadable: true,
    live: true,
    ...extra,
  }) as Stream;

const scrobbler: InstalledAddon = {
  id: 'a',
  url: 'https://scrobbler.example/manifest.json',
  manifest: {
    id: 'org.example.scrobbler',
    version: '1.0.0',
    protocol: 1,
    name: 'Scrobbler',
    description: '',
    types: ['episode'],
    resources: ['scrobble'],
    catalogs: [],
  } satisfies Manifest,
  builtin: false,
};

function addStation(stream = liveStream()) {
  const db = createTestDb();
  const bookId = addStreamedBook(db, {
    addonUrl: 'https://radio.example/manifest.json',
    meta: station,
    stream,
    now: 100,
    newId,
  });
  return { db, bookId, location: getBook(db, ME, bookId)?.files[0]?.location ?? '' };
}

describe('live streams', () => {
  it('keeps the flag and the MIME type, and never allows a download', () => {
    const { db, bookId } = addStation();
    expect(isLiveBook(db, bookId)).toBe(true);
    expect(streamMime(db, bookId)).toBe('application/vnd.apple.mpegurl');
    expect(downloadAllowed(db, bookId)).toBe(false);
  });

  it('a stream without the flag is no live stream', () => {
    const { db, bookId } = addStation(liveStream({ live: false }));
    expect(isLiveBook(db, bookId)).toBe(false);
    expect(downloadAllowed(db, bookId)).toBe(true);
  });

  it('saves no place, so Continue listening never lists it', () => {
    const { db, bookId, location } = addStation();
    const saved = saveProgress(
      db,
      ME,
      { bookId, fileLocation: location, filePositionMs: 2_220_000, savedAt: 1_000 },
      'app',
    );
    expect(saved).toBe(false);
    expect(continueListening(db, ME)).toBeNull();
  });

  it('counts towards no stats and is never finished', () => {
    const { db, bookId } = addStation();
    recordListening(db, ME, { day: '2026-11-20', bookId, title: station.name, ms: 60_000 });
    expect(listeningRows(db, ME)).toEqual([]);
    finishFromPlayer(db, ME, bookId, 2_000);
    expect(getBook(db, ME, bookId)?.book.finishedAt).toBeNull();
    setFinished(db, ME, bookId, true, 3_000);
    expect(getBook(db, ME, bookId)?.book.finishedAt).toBeNull();
  });

  it('sends a start scrobble event and nothing more', () => {
    const { db, bookId } = addStation();
    const event = (name: 'start' | 'progress' | 'pause') => ({
      event: name,
      at: 1_000,
      item: { type: 'episode' as const, id: station.id, name: station.name },
      positionMs: 0,
    });
    const send = (name: 'start' | 'progress' | 'pause') =>
      enqueueScrobble(db, {
        profileId: ME,
        addons: [scrobbler],
        event: event(name),
        newId,
        bookId,
      });
    expect(send('start')).not.toBeNull();
    expect(send('progress')).toBeNull();
    expect(send('pause')).toBeNull();
    expect(db.select().from(scrobbleOutbox).all()).toHaveLength(1);
  });
});

describe('isHls', () => {
  it('reads the MIME type first, else the address', () => {
    expect(isHls('https://x.example/live', 'application/x-mpegURL')).toBe(true);
    expect(isHls('https://x.example/live.m3u8', 'audio/mpeg')).toBe(false);
    expect(isHls('https://x.example/live.m3u8?token=1')).toBe(true);
    expect(isHls('https://x.example/stream.mp3')).toBe(false);
  });
});

describe('nowPlayingLine', () => {
  it('takes the ICY title, else ID3 artist and title', () => {
    expect(nowPlayingLine({ streamTitle: '  Nina Simone - Feeling Good ' })).toBe(
      'Nina Simone - Feeling Good',
    );
    expect(nowPlayingLine({ streamTitle: '-', title: 'News', artist: null })).toBe('News');
    expect(nowPlayingLine({ title: 'Feeling Good', artist: 'Nina Simone' })).toBe(
      'Nina Simone - Feeling Good',
    );
    expect(nowPlayingLine({ streamTitle: '' })).toBeNull();
  });
});
