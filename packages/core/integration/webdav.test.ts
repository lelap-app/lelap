import { beforeAll, describe, expect, it } from 'vitest';

import { coverGuesses, folderCoverFiles, type ImageSize } from '../src/library/files';
import { groupIntoBooks } from '../src/library/group';
import { IMAGE_HEAD_BYTES, imageSize } from '../src/library/imageSize';
import type { ListedFile } from '../src/library/scan';
import { RemoteError } from '../src/remote/http';
import { checkWebdav, listWebdav, webdavHeaders } from '../src/remote/webdav';
import { testLibrary } from './fixtures';
import { reachable, seedWebdav, webdav } from './servers';

const library = testLibrary();
const scanned = (files: ListedFile[]) =>
  files.map((f) => ({
    ...f,
    durationMs: 0,
    title: null,
    album: null,
    artist: null,
    albumArtist: null,
    coverPath: null,
    chapters: [],
  }));

describe('WebDAV against rclone serve webdav', () => {
  beforeAll(async () => {
    await reachable(webdav.url);
    await seedWebdav(library);
  });

  it('checks the login by reading the folder entered', async () => {
    expect(await checkWebdav(fetch, webdav)).toEqual({ folders: 2, files: 1 });
  });

  it('reads a subfolder entered without a trailing slash', async () => {
    const url = new URL('Ada%20Quill/The%20Lantern%20Orchard', webdav.url).href;
    expect(await checkWebdav(fetch, { ...webdav, url })).toEqual({ folders: 0, files: 4 });
  });

  it('refuses a wrong password with a RemoteError', async () => {
    const wrong = checkWebdav(fetch, { ...webdav, password: 'wrong' });
    await expect(wrong).rejects.toBeInstanceOf(RemoteError);
    await expect(wrong).rejects.toMatchObject({ status: 401 });
  });

  it('lists every file with its path, size and time, and the files make books', async () => {
    const files = await listWebdav(fetch, webdav);
    expect(files.map((f) => f.relPath).sort()).toEqual([...library.keys()].sort());
    for (const file of files) {
      expect(file.size).toBe(library.get(file.relPath)?.length);
      expect(file.modifiedAt).toBeGreaterThan(Date.UTC(2020, 0, 1));
      expect(file.location.startsWith('webdav:')).toBe(true);
      expect(file.name).toBe(file.relPath.split('/').pop());
    }
    const books = groupIntoBooks('webdav:test', scanned(files), new Map());
    expect(books.map((b) => b.title).sort()).toEqual([
      'Loose & odd #1 (50%)',
      'Søndag på øen',
      'The Lantern Orchard',
    ]);
  });

  it('plays each listed file from its URI with the login', async () => {
    for (const file of await listWebdav(fetch, webdav)) {
      const response = await fetch(file.uri, { headers: webdavHeaders(webdav) });
      expect(response.status, file.relPath).toBe(200);
      const body = new Uint8Array(await response.arrayBuffer());
      expect(body).toEqual(library.get(file.relPath));
    }
  });

  it('answers a Range read with the first bytes only', async () => {
    const files = await listWebdav(fetch, webdav);
    const audio = files.find((f) => f.name === '01 Arrival.mp3') as ListedFile;
    const response = await fetch(audio.uri, {
      headers: { ...webdavHeaders(webdav), Range: 'bytes=0-0' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 0-0/${audio.size}`);
    expect((await response.arrayBuffer()).byteLength).toBe(1);
  });

  it('reads a cover’s size from its first 64 KB, the way the scan picks covers', async () => {
    const files = await listWebdav(fetch, webdav);
    const sizes = new Map<string, ImageSize>();
    for (const file of coverGuesses(files)) {
      const response = await fetch(file.uri, {
        headers: { ...webdavHeaders(webdav), Range: `bytes=0-${IMAGE_HEAD_BYTES - 1}` },
      });
      expect(response.status).toBe(206);
      const head = new Uint8Array(await response.arrayBuffer());
      expect(head.length).toBe(Math.min(IMAGE_HEAD_BYTES, file.size));
      const size = imageSize(head);
      if (size) sizes.set(file.name, size);
    }
    expect(Object.fromEntries(sizes)).toEqual({
      'art.png': { width: 600, height: 600 },
      'back.png': { width: 1200, height: 400 },
    });
    const byLocation = new Map(
      files.flatMap((f) =>
        sizes.has(f.name) ? [[f.location, sizes.get(f.name) as ImageSize]] : [],
      ),
    );
    const chosen = folderCoverFiles(files, byLocation);
    expect([...chosen.byFolder.values()].map((f) => f.name)).toEqual(['art.png']);
  });
});
