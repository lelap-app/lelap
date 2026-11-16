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
