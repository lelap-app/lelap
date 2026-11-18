import { describe, expect, it } from 'vitest';

import { compareNatural, folderCoverCacheName, folderCoverFiles, isAudioFile } from './files';

describe('folder covers', () => {
  const file = (location: string) => ({
    location,
    name: location.slice(location.lastIndexOf('/') + 1),
    size: 10,
    modifiedAt: 5,
  });

  it('picks one image per folder, in any case, cover before folder and JPEG first', () => {
    const covers = folderCoverFiles([
      file('webdav:nas/Books/Dune/Folder.JPG'),
      file('webdav:nas/Books/Dune/cover.png'),
      file('webdav:nas/Books/Dune/COVER.jpg'),
      file('webdav:nas/Books/Dune/01.mp3'),
      file('webdav:nas/Books/Emma/folder.jpg'),
      file('webdav:nas/Books/Emma/back.jpg'),
      file('s3:bucket/Books/Odyssey/cover.webp'),
      file('s3:bucket/Books/Odyssey/cover.png'),
    ]);
    expect(Object.fromEntries([...covers].map(([folder, f]) => [folder, f.name]))).toEqual({
      'webdav:nas/Books/Dune': 'COVER.jpg',
      'webdav:nas/Books/Emma': 'folder.jpg',
      's3:bucket/Books/Odyssey': 'cover.png',
    });
  });

  it('names the cached copy after the file and its version', () => {
    const a = file('webdav:nas/Books/Dune/cover.JPG');
    expect(folderCoverCacheName(a)).toMatch(/^folder-[0-9a-f]{8}\.jpg$/);
    expect(folderCoverCacheName(a)).toBe(folderCoverCacheName({ ...a }));
    expect(folderCoverCacheName({ ...a, modifiedAt: 6 })).not.toBe(folderCoverCacheName(a));
    expect(folderCoverCacheName({ ...a, location: 'webdav:nas/Books/Emma/cover.JPG' })).not.toBe(
      folderCoverCacheName(a),
    );
  });
});

describe('isAudioFile', () => {
  it('accepts the audio extensions in any case', () => {
    for (const name of [
      'a.mp3',
      'b.M4B',
      'c.m4a',
      'd.aac',
      'e.ogg',
      'f.oga',
      'g.opus',
      'h.flac',
      'i.wav',
    ]) {
      expect(isAudioFile(name), name).toBe(true);
    }
  });

  it('rejects everything else', () => {
    for (const name of ['cover.jpg', 'position.dat', 'notes.xml', '.nomedia', 'mp3']) {
      expect(isAudioFile(name), name).toBe(false);
    }
  });
});

describe('compareNatural', () => {
  const sorted = (names: string[]) => [...names].sort(compareNatural);

  it('orders numbers by value', () => {
    expect(sorted(['10.mp3', '2.mp3', '1.mp3'])).toEqual(['1.mp3', '2.mp3', '10.mp3']);
  });

  it('orders episode codes', () => {
    expect(sorted(['Show.S02E01.mp3', 'Show.S01E10.mp3', 'Show.S01E09.mp3'])).toEqual([
      'Show.S01E09.mp3',
      'Show.S01E10.mp3',
      'Show.S02E01.mp3',
    ]);
  });

  it('orders Danish letters after z', () => {
    expect(sorted(['Ål', 'Øl', 'Æble', 'Zebra'])).toEqual(['Zebra', 'Æble', 'Øl', 'Ål']);
  });
});
