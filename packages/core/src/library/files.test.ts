import { describe, expect, it } from 'vitest';

import { ROOT, scanned } from '../../test/files';
import {
  compareNatural,
  coverGuesses,
  folderCoverCacheName,
  folderCoverFiles,
  type ImageSize,
  isAudioFile,
  isImageFile,
} from './files';
import { groupIntoBooks } from './group';

const file = (location: string, size = 10) => ({
  location,
  name: location.slice(location.lastIndexOf('/') + 1),
  size,
  modifiedAt: 5,
});

/** The chosen image's name per folder and per audio file, relative to `webdav:nas`. */
function choose(names: (string | [string, number])[], sizes: Record<string, ImageSize> = {}) {
  const files = names.map((n) =>
    typeof n === 'string' ? file(`webdav:nas/${n}`) : file(`webdav:nas/${n[0]}`, n[1]),
  );
  const covers = folderCoverFiles(
    files,
    new Map(Object.entries(sizes).map(([n, s]) => [`webdav:nas/${n}`, s])),
  );
  const short = (map: Map<string, { name: string }>) =>
    Object.fromEntries([...map].map(([k, f]) => [k.slice('webdav:nas/'.length), f.name]));
  return { byFolder: short(covers.byFolder), byFile: short(covers.byFile) };
}

describe('covers from image files', () => {
  it('knows JPEG, PNG and WebP in any case', () => {
    for (const name of ['a.jpg', 'b.JPEG', 'c.png', 'd.WebP']) expect(isImageFile(name)).toBe(true);
    for (const name of ['a.gif', 'b.mp3', 'jpg', 'notes.txt'])
      expect(isImageFile(name)).toBe(false);
  });

  it('rule 2: an image with the audio file’s name is that file’s', () => {
    const { byFile, byFolder } = choose([
      'Show/s01e01.mp3',
      'Show/s01e01.jpg',
      'Show/s01e02.mp3',
      'Show/S01E02.PNG',
      'Books/Book A.mp3',
      'Books/Book A.png',
      'Books/Book A.webp',
      'Books/Book A.jpg',
    ]);
    expect(byFile).toEqual({
      'Show/s01e01.mp3': 's01e01.jpg',
      'Show/s01e02.mp3': 'S01E02.PNG',
      'Books/Book A.mp3': 'Book A.jpg',
    });
    // Images named after an audio file are never shared with the folder's other books.
    expect(byFolder).toEqual({});
  });

  it('rule 3: the usual names, in order, JPEG first', () => {
    const names = [
      'AlbumArt_{7D9A}_Large.jpg',
      'AlbumArt.jpg',
      'poster.jpg',
      'front.jpg',
      'Folder.JPG',
      'cover.png',
      'COVER.jpg',
    ];
    // Take the winner away each time: the next one in line wins.
    for (let i = names.length; i > 0; i--) {
      const kept = names.slice(0, i);
      const { byFolder } = choose([
        'Dune/01.mp3',
        'Dune/back.jpg',
        ...kept.map((n) => `Dune/${n}`),
      ]);
      expect(byFolder.Dune).toBe(kept.at(-1));
    }
    // A small album art is no usual name: it is one to guess among.
    const small = ['Dune/01.mp3', 'Dune/AlbumArtSmall.jpg', 'Dune/x.jpg'];
    expect(coverGuesses(small.map((n) => file(`webdav:nas/${n}`)))).toHaveLength(2);
  });

  it('rule 4: an image named after the folder', () => {
    expect(choose(['Dune/01.mp3', 'Dune/back.jpg', 'Dune/dune.png']).byFolder.Dune).toBe(
      'dune.png',
    );
  });

  it('rule 5: the only image, whatever its name', () => {
    expect(choose(['Dune/01.mp3', 'Dune/scan 1.webp']).byFolder.Dune).toBe('scan 1.webp');
    // An image named after another book's file is not the folder's only image.
    expect(choose(['Books/A.mp3', 'Books/A.jpg', 'Books/B.mp3', 'Books/art.jpg']).byFolder).toEqual(
      { Books: 'art.jpg' },
    );
  });

  it('rule 6: the most nearly square image, then the largest, then the first by name', () => {
    const files = ['Dune/01.mp3', 'Dune/b.jpg', 'Dune/a.jpg', 'Dune/c.jpg'];
    const square = { width: 500, height: 500 };
    expect(
      choose(files, {
        'Dune/a.jpg': { width: 1000, height: 1500 },
        'Dune/b.jpg': square,
        'Dune/c.jpg': { width: 3000, height: 2000 },
      }).byFolder.Dune,
    ).toBe('b.jpg');
    expect(
      choose(files, {
        'Dune/a.jpg': square,
        'Dune/b.jpg': { width: 1400, height: 1400 },
        'Dune/c.jpg': { width: 601, height: 600 },
      }).byFolder.Dune,
    ).toBe('b.jpg');
    expect(
      choose(files, { 'Dune/a.jpg': square, 'Dune/b.jpg': square, 'Dune/c.jpg': square }).byFolder
        .Dune,
    ).toBe('a.jpg');
  });

  it('rule 6 without sizes: images with one first, then the largest file', () => {
    const files: [string, number][] = [
      ['Dune/01.mp3', 9],
      ['Dune/a.jpg', 100],
      ['Dune/b.jpg', 300],
      ['Dune/c.jpg', 200],
    ];
    expect(choose(files).byFolder.Dune).toBe('b.jpg');
    expect(choose(files, { 'Dune/a.jpg': { width: 10, height: 30 } }).byFolder.Dune).toBe('a.jpg');
  });

  it('lists the images a guess needs sizes for, and no others', () => {
    const files = [
      'Dune/01.mp3',
      'Dune/a.jpg',
      'Dune/b.jpg',
      'Emma/01.mp3',
      'Emma/cover.jpg',
      'Emma/back.jpg',
      'Odyssey/01.mp3',
      'Odyssey/only.jpg',
      'Scans/1.jpg',
      'Scans/2.jpg',
    ].map((n) => file(`webdav:nas/${n}`));
    expect(coverGuesses(files).map((f) => f.location)).toEqual([
      'webdav:nas/Dune/a.jpg',
      'webdav:nas/Dune/b.jpg',
    ]);
  });

  it('finds the cover above disc folders, not in folders without books', () => {
    expect(
      choose(['Dune/CD 1/01.mp3', 'Dune/CD 2/01.mp3', 'Dune/front.jpg', 'Scans/1.jpg']).byFolder,
    ).toEqual({ Dune: 'front.jpg' });
  });

  describe('books that are single files in a folder', () => {
    const chaptered = { chapters: [{ title: 'One', startMs: 0 }] };
    /** Each book's cover after choosing and grouping, with images named by their file name. */
    function coversOf(audio: ReturnType<typeof scanned>[], images: string[]) {
      const listing = [...audio, ...images.map((n) => file(`${ROOT}/${n}`))];
      const covers = folderCoverFiles(listing);
      const paths = (map: Map<string, { name: string }>) =>
        new Map([...map].map(([k, f]) => [k, f.name]));
      return Object.fromEntries(
        groupIntoBooks(
          ROOT,
          audio,
          paths(covers.byFolder),
          paths(covers.byFile),
          paths(covers.forLoose),
        ).map((b) => [b.location.slice(ROOT.length + 1), b.coverPath]),
      );
    }

    it('don’t share an image named after the folder', () => {
      const books = [
        scanned('Author/Book1.m4b', chaptered),
        scanned('Author/Book2.m4b', chaptered),
      ];
      expect(coversOf(books, ['Author/author.jpg'])).toEqual({
        'Author/Book1.m4b': null,
        'Author/Book2.m4b': null,
      });
      // The same folder as one book does take it.
      expect(coversOf([scanned('Author/Book1.m4b')], ['Author/author.jpg'])).toEqual({
        Author: 'author.jpg',
      });
    });

    it('don’t take another book’s image', () => {
      expect(coversOf([scanned('A.mp3'), scanned('B.mp3')], ['A cover.jpg'])).toEqual({
        'A.mp3': null,
        'B.mp3': null,
      });
    });

    it('don’t get a guess between two books’ images', () => {
      const books = [scanned('Author/A.m4b', chaptered), scanned('Author/B.m4b', chaptered)];
      expect(coversOf(books, ['Author/A (cover).jpg', 'Author/B (cover).jpg'])).toEqual({
        'Author/A.m4b': null,
        'Author/B.m4b': null,
      });
    });

    it('don’t take a stray image, only the folder’s cover or folder image', () => {
      const loose = [scanned('A.mp3'), scanned('B.mp3')];
      expect(coversOf(loose, ['Screenshot 1.png'])).toEqual({ 'A.mp3': null, 'B.mp3': null });
      expect(coversOf(loose, ['Screenshot 1.png', 'Folder.jpg', 'B.png'])).toEqual({
        'A.mp3': 'Folder.jpg',
        'B.mp3': 'B.png',
      });
    });
  });

  it('applies the rules in order per book: embedded, own image, then the folder’s', () => {
    const books = groupIntoBooks(
      ROOT,
      [
        scanned('Books/A.mp3', { coverPath: '/embedded-a.jpg' }),
        scanned('Books/B.mp3'),
        scanned('Books/C.mp3'),
        scanned('Saga/01.mp3'),
        scanned('Saga/02.mp3', { coverPath: '/embedded-saga.jpg' }),
        scanned('Trilogy/01.mp3'),
        scanned('Trilogy/02.mp3'),
      ],
      new Map([
        [`${ROOT}/Books`, '/books-folder.jpg'],
        [`${ROOT}/Saga`, '/saga-folder.jpg'],
        [`${ROOT}/Trilogy`, '/trilogy-folder.jpg'],
      ]),
      new Map([
        [`${ROOT}/Books/A.mp3`, '/a.jpg'],
        [`${ROOT}/Books/B.mp3`, '/b.jpg'],
        [`${ROOT}/Saga/01.mp3`, '/saga-01.jpg'],
        [`${ROOT}/Trilogy/02.mp3`, '/trilogy-02.jpg'],
      ]),
    );
    // Books/ holds single-file books once each file has chapters; here they are one folder book.
    expect(
      Object.fromEntries(books.map((b) => [b.location.slice(ROOT.length + 1), b.coverPath])),
    ).toEqual({
      Books: '/embedded-a.jpg',
      Saga: '/embedded-saga.jpg',
      Trilogy: '/trilogy-folder.jpg',
    });
    const single = groupIntoBooks(
      ROOT,
      [scanned('A.mp3', { coverPath: '/embedded-a.jpg' }), scanned('B.mp3'), scanned('C.mp3')],
      new Map([[ROOT, '/root-guess.jpg']]),
      new Map([
        [`${ROOT}/A.mp3`, '/a.jpg'],
        [`${ROOT}/B.mp3`, '/b.jpg'],
      ]),
      new Map([[ROOT, '/root-cover.jpg']]),
    );
    // Single-file books take the folder's `cover.*`, never the folder book's choice.
    expect(single.map((b) => b.coverPath)).toEqual([
      '/embedded-a.jpg',
      '/b.jpg',
      '/root-cover.jpg',
    ]);
    const folder = groupIntoBooks(
      ROOT,
      [scanned('Saga/01.mp3'), scanned('Saga/02.mp3')],
      new Map([[`${ROOT}/Saga`, '/saga-folder.jpg']]),
      new Map([[`${ROOT}/Saga/01.mp3`, '/saga-01.jpg']]),
    );
    // A book of several files takes its first part's image before the folder's.
    expect(folder[0]?.coverPath).toBe('/saga-01.jpg');
  });

  it('picks one image per folder, in any case, cover before folder and JPEG first', () => {
    const covers = folderCoverFiles([
      file('webdav:nas/Books/Dune/Folder.JPG'),
      file('webdav:nas/Books/Dune/cover.png'),
      file('webdav:nas/Books/Dune/COVER.jpg'),
      file('webdav:nas/Books/Dune/01.mp3'),
      file('webdav:nas/Books/Emma/folder.jpg'),
      file('webdav:nas/Books/Emma/back.jpg'),
      file('webdav:nas/Books/Emma/01.mp3'),
      file('s3:bucket/Books/Odyssey/cover.webp'),
      file('s3:bucket/Books/Odyssey/cover.png'),
      file('s3:bucket/Books/Odyssey/01.m4b'),
    ]);
    expect(Object.fromEntries([...covers.byFolder].map(([folder, f]) => [folder, f.name]))).toEqual(
      {
        'webdav:nas/Books/Dune': 'COVER.jpg',
        'webdav:nas/Books/Emma': 'folder.jpg',
        's3:bucket/Books/Odyssey': 'cover.png',
      },
    );
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
