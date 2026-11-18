export type TimelineFile = { location: string; durationMs: number };

export type FilePosition = { index: number; location: string; positionMs: number };

/** Position on the whole-book timeline. Files of unknown duration (0) count as empty. */
export function toBookPosition(
  files: TimelineFile[],
  location: string,
  filePositionMs: number,
): number {
  const index = files.findIndex((f) => f.location === location);
  if (index < 0) return 0;
  let offset = 0;
  for (const file of files.slice(0, index)) offset += Math.max(0, file.durationMs);
  return offset + Math.max(0, filePositionMs);
}

/**
 * The file and offset for a whole-book position. A file of unknown duration takes whatever is
 * left, so positions inside it round-trip with toBookPosition.
 */
export function toFilePosition(files: TimelineFile[], bookPositionMs: number): FilePosition {
  let remaining = Math.max(0, bookPositionMs);
  for (const [index, file] of files.entries()) {
    if (file.durationMs <= 0 || remaining < file.durationMs) {
      return { index, location: file.location, positionMs: remaining };
    }
    remaining -= file.durationMs;
  }
  const last = files.at(-1);
  if (!last) return { index: 0, location: '', positionMs: 0 };
  return { index: files.length - 1, location: last.location, positionMs: last.durationMs };
}

/** Index of the chapter playing at a whole-book position, or -1. */
export function chapterAt(chapters: { startMs: number }[], bookPositionMs: number): number {
  let current = -1;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.startMs > bookPositionMs) break;
    current = index;
  }
  return current;
}

/**
 * The stretch a system media control shows as its progress bar: the chapter playing, or the whole
 * book when it has no chapters. Offsets are whole-book milliseconds.
 */
export function mediaSpan(
  chapters: { startMs: number }[],
  totalMs: number,
  bookPositionMs: number,
): { startMs: number; lengthMs: number } {
  const current = chapterAt(chapters, bookPositionMs);
  const start = chapters[current]?.startMs ?? 0;
  const end = Math.min(totalMs, chapters[current + 1]?.startMs ?? totalMs);
  // Durations still unknown, or chapters past the end of the files: the whole book.
  if (end <= start) return { startMs: 0, lengthMs: Math.max(0, totalMs) };
  return { startMs: start, lengthMs: end - start };
}

/** Within this much of a chapter's start, “previous chapter” goes to the one before. */
export const CHAPTER_RESTART_MS = 3_000;

/**
 * Where the previous or next chapter button goes from a whole-book position: back restarts the
 * chapter playing unless it has only just begun; forward goes to the next one, or nowhere (null).
 */
export function chapterJump(
  chapters: { startMs: number }[],
  bookPositionMs: number,
  forward: boolean,
): number | null {
  const current = chapterAt(chapters, bookPositionMs);
  if (forward) return chapters[current + 1]?.startMs ?? null;
  const start = chapters[current]?.startMs ?? 0;
  return bookPositionMs - start > CHAPTER_RESTART_MS
    ? start
    : (chapters[current - 1]?.startMs ?? 0);
}
