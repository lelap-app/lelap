import type { KindTags, StoredChapter } from '../schema';

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
  /** Where the file downloads from, when not from `uri`. */
  downloadUri?: string | null;
  durationMs: number;
  title: string | null;
  album: string | null;
  artist: string | null;
  albumArtist: string | null;
  coverPath: string | null;
  chapters: StoredChapter[];
  /** ISBNs and ASINs from the tags (`isbn:…`, `asin:…`); absent when the reader can't tell. */
  ids?: string[] | null;
  /** Genre, ISRC and the like (M77); absent when the reader can't tell. */
  kindTags?: KindTags | null;
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

const COVER_IMAGE = /^(cover|folder)\.(jpe?g|png|webp)$/i;
const COVER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

/** `cover.jpg` before `folder.jpg`; JPEG before PNG before WebP. */
function coverRank(name: string): number {
  const [base = '', ext = ''] = name.toLowerCase().split('.');
  return (base === 'cover' ? 0 : COVER_EXTENSIONS.length) + COVER_EXTENSIONS.indexOf(ext);
}

/**
 * The cover image in each folder (`cover.jpg`, `folder.jpg`, `cover.png`, … in any case), by the
 * folder's location. A book uses it when its files carry no cover of their own.
 */
export function folderCoverFiles<F extends { location: string; name: string }>(
  files: F[],
): Map<string, F> {
  const covers = new Map<string, F>();
  for (const file of files) {
    if (!COVER_IMAGE.test(file.name)) continue;
    const folder = file.location.slice(0, file.location.lastIndexOf('/'));
    const current = covers.get(folder);
    if (!current || coverRank(file.name) < coverRank(current.name)) covers.set(folder, file);
  }
  return covers;
}

/**
 * The name a server folder's cover is kept under on the device. It changes when the image on the
 * server does, so an unchanged cover is not fetched again on every scan.
 */
export function folderCoverCacheName(file: {
  location: string;
  name: string;
  size: number;
  modifiedAt: number;
}): string {
  // FNV-1a: short and stable; a collision only shows the wrong cover until the next change.
  let hash = 0x811c9dc5;
  for (const char of `${file.location}|${file.size}|${file.modifiedAt}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  return `folder-${hash.toString(16).padStart(8, '0')}.${ext}`;
}
