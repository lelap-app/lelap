import { utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * A big file kept as fixed-size chunk files plus a manifest, so a save writes only the chunks
 * that changed. The web app keeps its SQLite database this way in the origin private file system
 * (M67): writing the whole file after each change is 49 MB at 10,000 books.
 *
 * A changed chunk goes to a new file name, and the manifest names the current file of each chunk.
 * Writing the manifest is the commit: a save cut short leaves the old manifest and its chunks
 * whole, and the next save clears the strays.
 *
 * A chunk counts as changed when its bytes differ from the last load or save, kept in memory
 * (M80): hashing every chunk took about a second per save at 10,000 books on plain http.
 */

export const CHUNK_BYTES = 256 * 1024;
export const MANIFEST = 'manifest.json';

/** A folder of files; `write` replaces a file in one step (OPFS `createWritable` does). */
export type ChunkStore = {
  read: (name: string) => Promise<Uint8Array | null>;
  write: (name: string, bytes: Uint8Array) => Promise<void>;
  remove: (name: string) => Promise<void>;
  list: () => Promise<string[]>;
};

type Manifest = {
  version: 1;
  generation: number;
  size: number;
  chunkBytes: number;
  chunks: string[];
};

// The manifest is plain ASCII (numbers and names like `12.3`), so a byte is a character.
const ascii = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

function parseManifest(bytes: Uint8Array): Manifest | null {
  try {
    const value = JSON.parse(ascii(bytes)) as Partial<Manifest>;
    if (
      value.version !== 1 ||
      typeof value.generation !== 'number' ||
      typeof value.size !== 'number' ||
      typeof value.chunkBytes !== 'number' ||
      !Array.isArray(value.chunks) ||
      !value.chunks.every((c) => typeof c === 'string') ||
      value.chunks.length !== Math.ceil(value.size / value.chunkBytes)
    ) {
      return null;
    }
    return value as Manifest;
  } catch {
    return null;
  }
}

const chunksOf = (bytes: Uint8Array, size: number): Uint8Array[] => {
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += size) chunks.push(bytes.subarray(at, at + size));
  return chunks;
};

/** Whether two chunks hold the same bytes; four at a time where both line up. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let i = 0;
  if (a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0) {
    const words = a.length >>> 2;
    const x = new Uint32Array(a.buffer, a.byteOffset, words);
    const y = new Uint32Array(b.buffer, b.byteOffset, words);
    for (let w = 0; w < words; w++) if (x[w] !== y[w]) return false;
    i = words << 2;
  }
  for (; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type SaveResult = { chunksWritten: number; bytesWritten: number };

export class ChunkedFile {
  private manifest: Manifest | null = null;
  // A copy of what the manifest names, to compare the next save with.
  private last: Uint8Array = new Uint8Array(0);
  // Never reused, so a save never overwrites a file the current manifest names.
  private generation = 0;

  constructor(
    private readonly store: ChunkStore,
    private readonly chunkBytes = CHUNK_BYTES,
  ) {}

  /**
   * The saved bytes, or null when nothing was saved yet. Throws when the manifest can't be read or
   * a chunk is missing: starting empty would save over what is left.
   */
  async load(): Promise<Uint8Array | null> {
    const raw = await this.store.read(MANIFEST);
    if (!raw) return null;
    const manifest = parseManifest(raw);
    if (!manifest) throw new Error('The saved library’s list of parts can’t be read.');
    this.generation = manifest.generation;
    const bytes = new Uint8Array(manifest.size);
    for (const [i, name] of manifest.chunks.entries()) {
      const chunk = await this.store.read(name);
      const start = i * manifest.chunkBytes;
      const length = Math.min(manifest.chunkBytes, manifest.size - start);
      if (!chunk || chunk.length !== length) throw new Error(`The saved library lost part ${i}.`);
      bytes.set(chunk, start);
    }
    // A manifest made with another chunk size is rewritten in full on the next save.
    if (manifest.chunkBytes === this.chunkBytes) {
      this.manifest = manifest;
      this.last = bytes.slice();
    }
    return bytes;
  }

  /** Writes the chunks that differ from the last load or save, then the manifest. */
  async save(bytes: Uint8Array): Promise<SaveResult> {
    const previous = this.manifest;
    const generation = this.generation + 1;
    const chunks = chunksOf(bytes, this.chunkBytes);
    const names: string[] = [];
    const changed: number[] = [];
    let bytesWritten = 0;
    let chunksWritten = 0;
    for (const [i, chunk] of chunks.entries()) {
      const old = previous?.chunks[i];
      const start = i * this.chunkBytes;
      // Compared at its saved length: a last chunk that shrank or grew is a new file.
      if (
        old !== undefined &&
        sameBytes(chunk, this.last.subarray(start, start + this.chunkBytes))
      ) {
        names.push(old);
      } else {
        const name = `${i}.${generation}`;
        await this.store.write(name, chunk);
        names.push(name);
        bytesWritten += chunk.length;
        chunksWritten++;
        changed.push(i);
      }
    }
    const manifest: Manifest = {
      version: 1,
      generation,
      size: bytes.length,
      chunkBytes: this.chunkBytes,
      chunks: names,
    };
    await this.store.write(MANIFEST, utf8ToBytes(JSON.stringify(manifest)));
    this.manifest = manifest;
    // Only the written chunks are copied, unless the size changed.
    if (this.last.length !== bytes.length) {
      this.last = bytes.slice();
    } else {
      for (const i of changed) {
        const start = i * this.chunkBytes;
        this.last.set(bytes.subarray(start, start + this.chunkBytes), start);
      }
    }
    this.generation = generation;
    await this.prune();
    return { chunksWritten, bytesWritten };
  }

  /** Removes chunk files the manifest no longer names, such as those of a save cut short. */
  private async prune(): Promise<void> {
    const keep = new Set([MANIFEST, ...(this.manifest?.chunks ?? [])]);
    for (const name of await this.store.list()) {
      if (!keep.has(name)) await this.store.remove(name);
    }
  }
}
