import { describe, expect, it } from 'vitest';

import { scanned } from '../../test/files';
import { buildChapters } from './chapters';

describe('buildChapters', () => {
  it('shifts embedded chapters by the earlier files’ durations', () => {
    const chapters = buildChapters([
      scanned('Book/1.m4b', { durationMs: 1000, chapters: [{ title: 'A', startMs: 0 }] }),
      scanned('Book/2.m4b', {
        durationMs: 1000,
        chapters: [
          { title: 'B', startMs: 0 },
          { title: 'C', startMs: 400 },
        ],
      }),
    ]);
    expect(chapters).toEqual([
      { title: 'A', startMs: 0 },
      { title: 'B', startMs: 1000 },
      { title: 'C', startMs: 1400 },
    ]);
  });

  it('makes one chapter per part with the episode code in front', () => {
    const chapters = buildChapters([
      scanned('Show/Show.S01E01.Pilot.mp3', { durationMs: 500, title: 'Pilot' }),
      scanned('Show/Show.S1E2.Next.mp3', { durationMs: 500 }),
      scanned('Show/Show.E07.Other.mp3', { durationMs: 500, title: 'Other' }),
    ]);
    expect(chapters).toEqual([
      { title: 'S01E01 · Pilot', startMs: 0 },
      { title: 'S01E02 · Show.S1E2.Next', startMs: 500 },
      { title: 'E07 · Other', startMs: 1000 },
    ]);
  });

  it('titles parts without a code by tag, then file name', () => {
    expect(
      buildChapters([scanned('B/01.mp3', { title: 'Opening' }), scanned('B/02.mp3')]).map(
        (c) => c.title,
      ),
    ).toEqual(['Opening', '02']);
  });

  it('gives a single file without chapter tags no chapters', () => {
    expect(buildChapters([scanned('Book/book.mp3')])).toEqual([]);
  });
});
