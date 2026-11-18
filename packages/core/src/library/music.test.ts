import { describe, expect, it } from 'vitest';

import type { KindTags } from '../schema';
import {
  hasIsrcCode,
  isMusicGenre,
  isSpokenGenre,
  MUSIC_RULES,
  type MusicEvidence,
  musicScore,
} from './music';

const NO_TAGS: KindTags = {
  genre: null,
  isrc: null,
  track: null,
  year: null,
  narrator: null,
  mediaKind: null,
};

const song = (over: Partial<MusicEvidence> = {}, tags: Partial<KindTags> | null = {}) => ({
  fileCount: 1,
  durationMs: 3 * 60_000,
  chapterCount: 0,
  fileName: 'Example Song - Example Artist.mp3',
  title: 'Example Song - Example Artist',
  album: null,
  bookSource: false,
  ...over,
  tags: tags === null ? null : { ...NO_TAGS, ...tags },
});

describe('musicScore', () => {
  it('suggests a short single file with an ISRC tag', () => {
    const score = musicScore(song({}, { isrc: 'XX0AB2400001' }));
    expect(score.suggest).toBe(true);
    expect(score.signals).toEqual(['songLength', 'isrcTag']);
  });

  it('suggests a title with an ISRC-shaped code, as the maintainer’s files have, on the web too', () => {
    const title = 'Example Song - Example Artist [XX0AB2400001 - FLAC]';
    const score = musicScore(song({ title, fileName: `${title}.flac` }, null));
    expect(score.suggest).toBe(true);
    expect(score.signals).toEqual(['songLength', 'isrcInTitle', 'flac']);
  });

  it('suggests music genre and music-style tags', () => {
    const score = musicScore(
      song({ album: 'Example Album' }, { genre: 'Indie Rock', track: '3', year: '2021' }),
    );
    expect(score.signals).toEqual(['songLength', 'musicGenre', 'musicTags']);
    expect(score.suggest).toBe(true);
  });

  it('never suggests on one signal or weak evidence', () => {
    // Only the length, as the web knows of a server file.
    expect(musicScore(song({}, null)).suggest).toBe(false);
    // Short and FLAC: 3 points.
    expect(musicScore(song({ fileName: 'Example.flac' }, null)).suggest).toBe(false);
    // An ISRC alone, on a long file.
    expect(musicScore(song({ durationMs: 40 * 60_000 }, { isrc: 'XX0AB2400001' })).suggest).toBe(
      false,
    );
  });

  it('counts a narrator or composer against music-style tags', () => {
    const tagged = { genre: null, track: '1', year: '2020' };
    const book = song({ album: 'Example Album' }, { ...tagged, narrator: 'Example Reader' });
    expect(musicScore(book).signals).toEqual(['songLength']);
    const without = song({}, tagged);
    // No album: not music-style either.
    expect(musicScore(without).signals).toEqual(['songLength']);
  });

  it('lets a spoken genre outweigh everything', () => {
    const score = musicScore(
      song(
        { album: 'Example Album', fileName: 'Example.flac' },
        { genre: 'Audiobook', isrc: 'XX0AB2400001', track: '1', year: '2020' },
      ),
    );
    expect(score.suggest).toBe(false);
    expect(score.score).toBeLessThan(MUSIC_RULES.minScore);
  });

  it('never suggests what is surely a book', () => {
    const strong = { isrc: 'XX0AB2400001', genre: 'Pop' };
    expect(musicScore(song({ fileName: 'Example.m4b' }, strong)).suggest).toBe(false);
    expect(musicScore(song({}, { ...strong, mediaKind: 'audiobook' })).suggest).toBe(false);
    expect(musicScore(song({}, { ...strong, mediaKind: 'podcast' })).suggest).toBe(false);
    expect(musicScore(song({ chapterCount: 3 }, strong)).suggest).toBe(false);
    expect(musicScore(song({ fileCount: 2 }, strong)).suggest).toBe(false);
    expect(musicScore(song({ bookSource: true }, strong)).suggest).toBe(false);
  });

  it('treats 8 minutes as the end of song length', () => {
    const strong = { isrc: 'XX0AB2400001' };
    expect(musicScore(song({ durationMs: MUSIC_RULES.maxSongMs - 1 }, strong)).suggest).toBe(true);
    expect(musicScore(song({ durationMs: MUSIC_RULES.maxSongMs }, strong)).suggest).toBe(false);
    // A length of 0 means the reader found none.
    expect(musicScore(song({ durationMs: 0 }, strong)).signals).toEqual(['isrcTag']);
  });
});

describe('genres', () => {
  it('knows spoken genres in a few languages', () => {
    for (const g of ['Audiobook', 'Audio Book', 'Speech', 'Spoken Word', 'Podcast', 'Hörbuch']) {
      expect(isSpokenGenre(g), g).toBe(true);
      expect(isMusicGenre(g), g).toBe(false);
    }
  });

  it('knows music genres, also as ID3v1 numbers', () => {
    for (const g of ['Rock', 'Hip-Hop', 'Electronic; Dance', 'Classical', '(17)', '13']) {
      expect(isMusicGenre(g), g).toBe(true);
    }
    for (const g of ['Fiction', 'Fantasy', 'History', 'Comedy', '(101)']) {
      expect(isMusicGenre(g), g).toBe(false);
    }
  });
});

describe('hasIsrcCode', () => {
  it('finds ISRC-shaped codes and nothing else', () => {
    expect(hasIsrcCode('Example Song [XX0AB2400001]')).toBe(true);
    expect(hasIsrcCode('Example Song XX-0AB-24-00001')).toBe(true);
    expect(hasIsrcCode('Example Book, Part 1')).toBe(false);
    expect(hasIsrcCode('ISBN 9781234567897')).toBe(false);
    expect(hasIsrcCode('xx0ab2400001')).toBe(false);
  });
});
