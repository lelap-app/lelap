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
  /** An add-on's own note for the file (revision 13). */
  ref?: string | null;
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

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

/** A JPEG, PNG or WebP file, the images a cover can come from. */
export function isImageFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && IMAGE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

/** An image's width and height in pixels. */
export type ImageSize = { width: number; height: number };

/** JPEG before PNG before WebP, for two images with the same name. */
const extensionRank = (name: string) =>
  IMAGE_EXTENSIONS.indexOf(name.slice(name.lastIndexOf('.') + 1).toLowerCase());

// Rule 3, in this order. `AlbumArt_{…}_Large.jpg` is what Windows Media Player leaves.
const USUAL_NAMES = [
  /^cover$/i,
  /^folder$/i,
  /^front$/i,
  /^poster$/i,
  /^albumart$/i,
  /^albumart.*large$/i,
];

const LOOSE_NAMES = /^(cover|folder)$/i;

const usualRank = (name: string) => {
  const stem = stripExtension(name);
  return USUAL_NAMES.findIndex((pattern) => pattern.test(stem));
};

/** The same name in any case, with or without accents. */
const sameName = (a: string, b: string) => collator.compare(a, b) === 0;

const folderOf = (location: string) => location.slice(0, Math.max(0, location.lastIndexOf('/')));
const lastPart = (location: string) =>
  location.slice(Math.max(location.lastIndexOf('/'), location.lastIndexOf(':')) + 1);

/** First by name, so a guess stays the same between scans; the exact spelling breaks ties. */
const byName = (a: { name: string }, b: { name: string }) =>
  compareNatural(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const byExtensionThenName = (a: { name: string }, b: { name: string }) =>
  extensionRank(a.name) - extensionRank(b.name) || byName(a, b);

type CoverCandidate = { location: string; name: string; size: number };

type FolderFiles<F> = { images: F[]; audio: F[] };

/** Images and audio files per folder, by the folder's location. */
function filesByFolder<F extends CoverCandidate>(files: F[]): Map<string, FolderFiles<F>> {
  const folders = new Map<string, FolderFiles<F>>();
  const at = (folder: string) => {
    let entry = folders.get(folder);
    if (!entry) folders.set(folder, (entry = { images: [], audio: [] }));
    return entry;
  };
  for (const file of files) {
    if (isImageFile(file.name)) at(folderOf(file.location)).images.push(file);
    else if (isAudioFile(file.name)) at(folderOf(file.location)).audio.push(file);
  }
  // Only folders a book can sit in: with audio, or above disc folders (`Book/CD 1`).
  const withBooks = new Set<string>();
  for (const [folder, entry] of folders) {
    if (entry.audio.length === 0) continue;
    withBooks.add(folder);
    withBooks.add(folderOf(folder));
  }
  for (const folder of folders.keys()) if (!withBooks.has(folder)) folders.delete(folder);
  return folders;
}

/** The images a folder's books may share: not those named after one of its audio files. */
function sharedImages<F extends CoverCandidate>(entry: FolderFiles<F>): F[] {
  const stems = entry.audio.map((f) => stripExtension(f.name));
  return entry.images.filter(
    (image) => !stems.some((stem) => sameName(stem, stripExtension(image.name))),
  );
}

/** Rules 3 and 4: an image with a usual name, else one named after the folder. */
function settled<F extends CoverCandidate>(folder: string, images: F[]): F | null {
  const [usual] = images
    .filter((f) => usualRank(f.name) >= 0)
    .sort((a, b) => usualRank(a.name) - usualRank(b.name) || byExtensionThenName(a, b));
  if (usual) return usual;
  const name = lastPart(folder);
  const [named] = images
    .filter((f) => sameName(stripExtension(f.name), name))
    .sort(byExtensionThenName);
  return named ?? null;
}

/**
 * The images rule 6 guesses among, whose sizes the guess needs: in folders with more than one
 * image that no earlier rule settles.
 */
export function coverGuesses<F extends CoverCandidate>(files: F[]): F[] {
  const out: F[] = [];
  for (const [folder, entry] of filesByFolder(files)) {
    const shared = sharedImages(entry);
    if (shared.length > 1 && !settled(folder, shared)) out.push(...shared);
  }
  return out;
}

// Rounded to a hundredth, so of two near squares (600 × 601, 1400 × 1400) the larger wins.
const squareness = (s: ImageSize) =>
  Math.round((Math.min(s.width, s.height) / Math.max(s.width, s.height)) * 100);

/**
 * Rule 6: the most nearly square image, then the largest, then the first by name. Images whose
 * size is unknown come after those with one, largest file first.
 */
function guess<F extends CoverCandidate>(images: F[], sizes: Map<string, ImageSize>): F | null {
  const known = (f: F) => {
    const s = sizes.get(f.location);
    return s && s.width > 0 && s.height > 0 ? s : null;
  };
  const [first] = [...images].sort((a, b) => {
    const sa = known(a);
    const sb = known(b);
    if (sa && sb) {
      return (
        squareness(sb) - squareness(sa) ||
        sb.width * sb.height - sa.width * sa.height ||
        byName(a, b)
      );
    }
    if (sa || sb) return sa ? -1 : 1;
    return b.size - a.size || byName(a, b);
  });
  return first ?? null;
}

export type CoverFiles<F> = {
  /** Rule 2: per audio file's location, the image with its name (`Book A.mp3`, `Book A.png`). */
  byFile: Map<string, F>;
  /** Rules 3 to 6: per folder's location, the cover of the one book a folder becomes. */
  byFolder: Map<string, F>;
  /**
   * Per folder's location, for books that are single files in it (the library's top folder, or
   * files that each have chapters): only `cover.*` or `folder.*`. Any other image there is more
   * likely one book's than all of theirs.
   */
  forLoose: Map<string, F>;
};

/**
 * Covers from image files beside the audio, for books whose files carry none (rule 1, applied in
 * `groupIntoBooks`). Then, per book, the first that applies wins: 2. an image with the audio
 * file's name, the first part's for a book of several files; 3. `cover`, `folder`, `front`,
 * `poster`, `albumart`, `AlbumArt…Large`; 4. an image named after the folder; 5. the only image;
 * 6. a guess among several, which needs the `sizes` of the images `coverGuesses` lists. Rules 4
 * to 6 only fit a folder that is one book; books that are single files in a folder get `forLoose`.
 */
export function folderCoverFiles<F extends CoverCandidate>(
  files: F[],
  sizes: Map<string, ImageSize> = new Map(),
): CoverFiles<F> {
  const result: CoverFiles<F> = { byFile: new Map(), byFolder: new Map(), forLoose: new Map() };
  for (const [folder, entry] of filesByFolder(files)) {
    if (entry.images.length === 0) continue;
    for (const audio of entry.audio) {
      const stem = stripExtension(audio.name);
      const [own] = entry.images
        .filter((image) => sameName(stripExtension(image.name), stem))
        .sort(byExtensionThenName);
      if (own) result.byFile.set(audio.location, own);
    }
    const shared = sharedImages(entry);
    const [only] = shared;
    const chosen =
      settled(folder, shared) ?? (shared.length === 1 && only ? only : guess(shared, sizes));
    if (chosen) result.byFolder.set(folder, chosen);
    const [loose] = shared
      .filter((f) => LOOSE_NAMES.test(stripExtension(f.name)))
      .sort((a, b) => usualRank(a.name) - usualRank(b.name) || byExtensionThenName(a, b));
    if (loose) result.forLoose.set(folder, loose);
  }
  return result;
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
