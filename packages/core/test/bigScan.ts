import type { ScannedFile } from '../src/library/files';
import { splitScanned } from '../src/library/scan';

/**
 * A folder of `count` books, `Author/Book/01.mp3` to `03.mp3`, with tags read: what the phone's
 * scan hands `applyScan` for a big library.
 */
export function bigScan(count: number) {
  const rootLocation = 'primary:Audiobooks';
  const files: ScannedFile[] = [];
  for (let n = 0; n < count; n++) {
    const folder = `Author ${n % 1_200}/Book ${n}`;
    for (let f = 1; f <= 3; f++) {
      const relPath = `${folder}/0${f}.mp3`;
      files.push({
        location: `${rootLocation}/${relPath}`,
        relPath,
        name: `0${f}.mp3`,
        size: 40_000_000 + n,
        modifiedAt: 1_700_000_000_000,
        uri: `content://big/${encodeURIComponent(relPath)}`,
        durationMs: 3_600_000,
        title: `Part ${f}`,
        album: `Book ${n}`,
        artist: `Author ${n % 1_200}`,
        albumArtist: null,
        coverPath: null,
        chapters: [],
      });
    }
  }
  return { rootLocation, files, ...splitScanned(files) };
}
