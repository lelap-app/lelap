import { beforeAll, describe, expect, it } from 'vitest';

import { IMAGE_HEAD_BYTES, imageSize } from '../src/library/imageSize';
import type { ListedFile } from '../src/library/scan';
import { RemoteError } from '../src/remote/http';
import { listS3, parseS3Uri, presignGet } from '../src/remote/s3';
import { testLibrary } from './fixtures';
import { reachable, RUN, s3, seedS3 } from './servers';

const library = testLibrary();
// More than one page of a listing (S3 sends at most 1,000 keys a page).
const MANY = 1_005;

const keyOf = (file: ListedFile) => parseS3Uri(file.uri)?.key ?? '';

describe('S3 against MinIO', () => {
  beforeAll(async () => {
    await reachable(s3.endpoint);
    await seedS3(library, 'library/');
    // Outside the prefix: never listed.
    await seedS3(new Map([['stray.mp3', new Uint8Array(8)]]), 'elsewhere/');
    const many = new Map<string, Uint8Array>();
    for (let i = 0; i < MANY; i++) many.set(`${String(i).padStart(4, '0')}.mp3`, new Uint8Array(1));
    await seedS3(many, 'many/');
  }, 120_000);

  it('lists every object below the prefix with its path, size and time', async () => {
    const files = await listS3(fetch, s3, Date.now());
    expect(files.map((f) => f.relPath).sort()).toEqual([...library.keys()].sort());
    for (const file of files) {
      expect(file.size).toBe(library.get(file.relPath)?.length);
      expect(file.modifiedAt).toBeGreaterThan(Date.UTC(2020, 0, 1));
      expect(file.uri).toBe(`s3://${s3.bucket}/${s3.prefix}${file.relPath}`);
    }
  });

  it('reads a listing longer than one page', async () => {
    const files = await listS3(fetch, { ...s3, prefix: `${RUN}/many/` }, Date.now());
    expect(files).toHaveLength(MANY);
    expect(new Set(files.map((f) => f.relPath)).size).toBe(MANY);
  });

  it('refuses a wrong secret with a RemoteError', async () => {
    const wrong = listS3(fetch, { ...s3, secretAccessKey: 'wrong-secret' }, Date.now());
    await expect(wrong).rejects.toBeInstanceOf(RemoteError);
    await expect(wrong).rejects.toMatchObject({ status: 403 });
  });

  it('plays each object from a pre-signed link, with no header', async () => {
    for (const file of await listS3(fetch, s3, Date.now())) {
      const response = await fetch(presignGet(s3, keyOf(file), Date.now()));
      expect(response.status, file.relPath).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(library.get(file.relPath));
    }
  });

  it('answers a Range read on a pre-signed link, for seeking and covers', async () => {
    const files = await listS3(fetch, s3, Date.now());
    const cover = files.find((f) => f.name === 'art.png') as ListedFile;
    const response = await fetch(presignGet(s3, keyOf(cover), Date.now()), {
      headers: { Range: `bytes=0-${IMAGE_HEAD_BYTES - 1}` },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(
      `bytes 0-${IMAGE_HEAD_BYTES - 1}/${cover.size}`,
    );
    const head = new Uint8Array(await response.arrayBuffer());
    expect(imageSize(head)).toEqual({ width: 600, height: 600 });
  });

  it('refuses a pre-signed link once it has run out', async () => {
    const [file] = await listS3(fetch, s3, Date.now());
    const expired = presignGet(s3, keyOf(file as ListedFile), Date.now() - 120_000, 60);
    expect((await fetch(expired)).status).toBe(403);
  });
});
