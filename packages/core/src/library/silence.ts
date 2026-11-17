import type { StoredChapter } from '../schema';

/** A stretch of a file quieter than the threshold, in milliseconds from the file's start. */
export type Silence = { startMs: number; endMs: number };

export type SilenceRules = {
  /** RMS level, in dB below full scale, under which a 50 ms window counts as quiet. */
  thresholdDb: number;
  /** Quiet for at least this long is a candidate break; pauses between sentences are shorter. */
  minSilenceMs: number;
  /** No chapter is shorter than this, so a long pause mid-chapter does not split it. */
  minChapterMs: number;
};

/**
 * The rules for chapters from silences. The native scan gets `thresholdDb` and `minSilenceMs`
 * from here, so every rule is kept in this one place.
 */
export const SILENCE_RULES: SilenceRules = {
  thresholdDb: -45,
  minSilenceMs: 2_500,
  minChapterMs: 5 * 60_000,
};

// A chapter starts this long before the voice comes back, so its first word is never clipped.
const LEAD_IN_MS = 500;

/**
 * Chapter marks for a book from the silences found in each of its files, on the whole-book
 * timeline. The longest silences win: each is taken when it keeps every chapter at least
 * `minChapterMs` long. Returns no chapters when none fit, so a book is never given just one.
 */
export function silenceChapters(
  files: { durationMs: number; silences: Silence[] }[],
  title: (n: number) => string,
  rules: SilenceRules = SILENCE_RULES,
): StoredChapter[] {
  const totalMs = files.reduce((sum, f) => sum + Math.max(0, f.durationMs), 0);
  const candidates: { atMs: number; lengthMs: number }[] = [];
  let offset = 0;
  for (const file of files) {
    for (const s of file.silences) {
      const lengthMs = s.endMs - s.startMs;
      if (lengthMs < rules.minSilenceMs) continue;
      const atMs = offset + Math.max(s.startMs, s.endMs - Math.min(LEAD_IN_MS, lengthMs / 2));
      candidates.push({ atMs: Math.round(atMs), lengthMs });
    }
    offset += Math.max(0, file.durationMs);
  }
  candidates.sort((a, b) => b.lengthMs - a.lengthMs || a.atMs - b.atMs);

  const starts: number[] = [];
  for (const c of candidates) {
    if (c.atMs < rules.minChapterMs || totalMs - c.atMs < rules.minChapterMs) continue;
    if (starts.some((s) => Math.abs(s - c.atMs) < rules.minChapterMs)) continue;
    starts.push(c.atMs);
  }
  if (starts.length === 0) return [];
  return [0, ...starts.sort((a, b) => a - b)].map((startMs, i) => ({
    title: title(i + 1),
    startMs,
  }));
}
