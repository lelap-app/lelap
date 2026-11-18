import { describe, expect, it } from 'vitest';

import { type ChunkStore, ChunkedFile, MANIFEST, sameBytes } from './chunkedFile';

function memoryStore() {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  let failAfter = Infinity;
  const store: ChunkStore = {
    read: (name) => Promise.resolve(files.get(name)?.slice() ?? null),
    write: (name, bytes) => {
      if (writes.length >= failAfter) return Promise.reject(new Error('tab closed'));
      writes.push(name);
      files.set(name, bytes.slice());
      return Promise.resolve();
    },
    remove: (name) => {
      files.delete(name);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...files.keys()]),
  };
  return { store, files, writes, failAt: (n: number) => (failAfter = n) };
}

const filled = (length: number, seed: number) =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 251);

describe('ChunkedFile', () => {
  it('loads nothing before the first save', async () => {
    const { store } = memoryStore();
    expect(await new ChunkedFile(store, 16).load()).toBeNull();
  });

  it('writes every chunk once, then only the changed ones', async () => {
    const { store, writes } = memoryStore();
    const file = new ChunkedFile(store, 16);
    const bytes = filled(100, 1);
    expect(await file.save(bytes)).toEqual({ chunksWritten: 7, bytesWritten: 100 });
    expect(await file.save(bytes)).toEqual({ chunksWritten: 0, bytesWritten: 0 });

    writes.length = 0;
    bytes[40] = 255 - (bytes[40] ?? 0);
    expect(await file.save(bytes)).toEqual({ chunksWritten: 1, bytesWritten: 16 });
    expect(writes).toEqual(['2.3', MANIFEST]);
  });

  it('reads back what was saved, also after growing and shrinking', async () => {
    const { store } = memoryStore();
    const file = new ChunkedFile(store, 16);
    await file.save(filled(100, 1));
    const grown = filled(150, 1);
    await file.save(grown);
    expect(await new ChunkedFile(store, 16).load()).toEqual(grown);
    const shrunk = grown.slice(0, 33);
    await file.save(shrunk);
    expect(await new ChunkedFile(store, 16).load()).toEqual(shrunk);
  });

  it('only rewrites what changed after a fresh load', async () => {
    const { store } = memoryStore();
    await new ChunkedFile(store, 16).save(filled(64, 1));
    const file = new ChunkedFile(store, 16);
    const bytes = (await file.load()) ?? new Uint8Array();
    bytes[0] = 99;
    expect(await file.save(bytes)).toEqual({ chunksWritten: 1, bytesWritten: 16 });
  });

  it('keeps the last whole save when one is cut short, and clears its strays later', async () => {
    const { store, files, failAt, writes } = memoryStore();
    const file = new ChunkedFile(store, 16);
    const first = filled(64, 1);
    await file.save(first);
    failAt(writes.length + 2);
    await expect(file.save(filled(64, 2))).rejects.toThrow('tab closed');
    expect(await new ChunkedFile(store, 16).load()).toEqual(first);

    failAt(Infinity);
    const third = filled(64, 3);
    await file.save(third);
    expect(await new ChunkedFile(store, 16).load()).toEqual(third);
    expect([...files.keys()].sort()).toEqual(['0.2', '1.2', '2.2', '3.2', MANIFEST].sort());
  });

  it('rewrites everything when the chunk size changed', async () => {
    const { store } = memoryStore();
    await new ChunkedFile(store, 16).save(filled(64, 1));
    const file = new ChunkedFile(store, 32);
    const bytes = (await file.load()) ?? new Uint8Array();
    expect(await file.save(bytes)).toEqual({ chunksWritten: 2, bytesWritten: 64 });
    expect(await new ChunkedFile(store, 32).load()).toEqual(bytes);
  });

  it('says so when the manifest is broken, rather than starting empty', async () => {
    const { store, files } = memoryStore();
    await new ChunkedFile(store, 16).save(filled(64, 1));
    files.set(MANIFEST, new Uint8Array([123, 34]));
    await expect(new ChunkedFile(store, 16).load()).rejects.toThrow('list of parts');
  });

  it('says so when a chunk is missing', async () => {
    const { store, files } = memoryStore();
    await new ChunkedFile(store, 16).save(filled(64, 1));
    files.delete('1.1');
    await expect(new ChunkedFile(store, 16).load()).rejects.toThrow('lost part 1');
  });
});

describe('sameBytes', () => {
  it('compares whole words and the bytes after them, also when not aligned', () => {
    const a = filled(103, 1);
    expect(sameBytes(a, a.slice())).toBe(true);
    for (const at of [0, 50, 101, 102]) {
      const b = a.slice();
      b[at] = 255 - (b[at] ?? 0);
      expect(sameBytes(a, b)).toBe(false);
    }
    const shifted = new Uint8Array(104);
    shifted.set(a, 1);
    expect(sameBytes(a, shifted.subarray(1))).toBe(true);
    expect(sameBytes(a, a.subarray(0, 102))).toBe(false);
  });
});
