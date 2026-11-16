import type { ScannedFile } from '../src/library/files';

export const ROOT = 'primary:Audiobooks';

/** A scanned file under the test root with no tags unless given. */
export function scanned(relPath: string, tags: Partial<ScannedFile> = {}): ScannedFile {
  const name = relPath.split('/').at(-1) ?? relPath;
  return {
    location: `${ROOT}/${relPath}`,
    relPath,
    name,
    size: 1000,
    modifiedAt: 1,
    uri: `content://test/${encodeURIComponent(relPath)}`,
    durationMs: 60_000,
    title: null,
    album: null,
    artist: null,
    albumArtist: null,
    coverPath: null,
    chapters: [],
    ...tags,
  };
}
