import type { StoredChapter } from '../schema';

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav']);

/** A file from a scan of the library folder, with its tags. */
export type ScannedFile = {
  /** Volume path, such as `primary:Audiobooks/Book/01.mp3`. */
  location: string;
  /** Path below the library folder, `/`-separated. */
  relPath: string;
  name: string;
  size: number;
  modifiedAt: number;
  uri: string;
  durationMs: number;
  title: string | null;
  album: string | null;
  artist: string | null;
  albumArtist: string | null;
  coverPath: string | null;
  chapters: StoredChapter[];
};

export function isAudioFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && AUDIO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

// Danish collation puts æ, ø and å after z, matching how the maintainer's library is named.
const collator = new Intl.Collator('da', { numeric: true, sensitivity: 'base' });

/** Orders `2` before `10` and `S01E10` before `S02E01`. */
export function compareNatural(a: string, b: string): number {
  return collator.compare(a, b);
}
