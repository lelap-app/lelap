import { describe, expect, it } from 'vitest';

import { compareNatural, isAudioFile } from './files';

describe('isAudioFile', () => {
  it('accepts the audio extensions in any case', () => {
    for (const name of [
      'a.mp3',
      'b.M4B',
      'c.m4a',
      'd.aac',
      'e.ogg',
      'f.oga',
      'g.opus',
      'h.flac',
      'i.wav',
    ]) {
      expect(isAudioFile(name), name).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const name of ['cover.jpg', 'position.dat', 'notes.xml', '.nomedia', 'mp3']) {
      expect(isAudioFile(name), name).toBe(false);
    }
  });
});

describe('compareNatural', () => {
  const sorted = (names: string[]) => [...names].sort(compareNatural);

  it('orders numbers by value', () => {
    expect(sorted(['10.mp3', '2.mp3', '1.mp3'])).toEqual(['1.mp3', '2.mp3', '10.mp3']);
  });

  it('orders episode codes', () => {
    expect(sorted(['Show.S02E01.mp3', 'Show.S01E10.mp3', 'Show.S01E09.mp3'])).toEqual([
      'Show.S01E09.mp3',
      'Show.S01E10.mp3',
      'Show.S02E01.mp3',
    ]);
  });

  it('orders Danish letters after z', () => {
    expect(sorted(['Ål', 'Øl', 'Æble', 'Zebra'])).toEqual(['Zebra', 'Æble', 'Øl', 'Ål']);
  });
});
