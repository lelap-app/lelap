import type { StoredChapter } from '../schema';
import { type ScannedFile, stripExtension } from './files';

const pad = (n: string) => n.padStart(2, '0');

function episodeCode(name: string): string | null {
  const season = /\bS(\d{1,2})E(\d{1,3})(?!\d)/i.exec(name);
  if (season?.[1] && season[2]) return `S${pad(season[1])}E${pad(season[2])}`;
  const episode = /\bE(\d{1,3})\b/i.exec(name);
  return episode?.[1] ? `E${pad(episode[1])}` : null;
}

function partTitle(file: ScannedFile): string {
  const title = file.title ?? stripExtension(file.name);
  const code = episodeCode(file.name);
  return code ? `${code} · ${title}` : title;
}

/**
 * Chapters on the whole-book timeline: embedded chapters where files have them, one per part
 * otherwise, and none for a single file without chapter tags.
 */
export function buildChapters(files: ScannedFile[]): StoredChapter[] {
  const embedded = files.some((f) => f.chapters.length > 0);
  if (!embedded && files.length < 2) return [];

  const chapters: StoredChapter[] = [];
  let offset = 0;
  for (const file of files) {
    if (file.chapters.length > 0) {
      for (const c of file.chapters) chapters.push({ title: c.title, startMs: offset + c.startMs });
    } else {
      chapters.push({ title: partTitle(file), startMs: offset });
    }
    offset += Math.max(0, file.durationMs);
  }
  return chapters;
}
