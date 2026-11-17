import { describe, expect, it } from 'vitest';

import { SILENCE_RULES, silenceChapters } from './silence';

const MIN = 60_000;
const part = (n: number) => `Part ${n}`;

describe('silenceChapters', () => {
  it('starts a chapter just before the voice returns after a long silence', () => {
    const chapters = silenceChapters(
      [{ durationMs: 30 * MIN, silences: [{ startMs: 10 * MIN, endMs: 10 * MIN + 4_000 }] }],
      part,
    );
    expect(chapters).toEqual([
      { title: 'Part 1', startMs: 0 },
      { title: 'Part 2', startMs: 10 * MIN + 3_500 },
    ]);
  });

  it('ignores pauses shorter than the minimum silence', () => {
    const chapters = silenceChapters(
      [{ durationMs: 30 * MIN, silences: [{ startMs: 10 * MIN, endMs: 10 * MIN + 1_500 }] }],
      part,
    );
    expect(chapters).toEqual([]);
  });

  it('keeps every chapter at least the minimum length, preferring the longest silence', () => {
    const chapters = silenceChapters(
      [
        {
          durationMs: 40 * MIN,
          silences: [
            { startMs: 2 * MIN, endMs: 2 * MIN + 6_000 }, // too close to the start
            { startMs: 10 * MIN, endMs: 10 * MIN + 3_000 },
            { startMs: 12 * MIN, endMs: 12 * MIN + 5_000 }, // longer, wins over 10 min
            { startMs: 25 * MIN, endMs: 25 * MIN + 3_000 },
            { startMs: 37 * MIN, endMs: 37 * MIN + 8_000 }, // too close to the end
          ],
        },
      ],
      part,
    );
    expect(chapters.map((c) => Math.floor(c.startMs / MIN))).toEqual([0, 12, 25]);
    expect(chapters.map((c) => c.title)).toEqual(['Part 1', 'Part 2', 'Part 3']);
  });

  it('places silences of later files on the whole-book timeline', () => {
    const chapters = silenceChapters(
      [
        { durationMs: 20 * MIN, silences: [] },
        { durationMs: 20 * MIN, silences: [{ startMs: 8 * MIN, endMs: 8 * MIN + 3_000 }] },
      ],
      part,
    );
    expect(chapters[1]?.startMs).toBe(28 * MIN + 2_500);
  });

  it('uses rules it is given', () => {
    const chapters = silenceChapters(
      [{ durationMs: 4 * MIN, silences: [{ startMs: 2 * MIN, endMs: 2 * MIN + 1_000 }] }],
      part,
      { ...SILENCE_RULES, minSilenceMs: 800, minChapterMs: MIN },
    );
    expect(chapters).toHaveLength(2);
  });
});
