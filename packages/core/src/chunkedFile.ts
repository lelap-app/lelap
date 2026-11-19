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
 * A chunk counts as changed when its fingerprint differs from the one of the last load or save
 * (M106): two 32-bit hashes of different make, so a change slips through about once in 2^64.
 * M80 kept a whole copy to compare with instead, 49 MB at 10,000 books; SHA-256 before that took
 * about a second per save on plain http.
 */

export const CHUNK_BYTES = 256 * 1024;
export const MANIFEST = 'manifest.json';
const READS_AT_ONCE = 16;

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

/**
 * A chunk's fingerprint: a murmur3-style and an xxHash-style 32-bit hash, which mix differently,
 * so a change has to fool both. Not for anything an attacker controls; only for noticing change.
 */
export function chunkPrint(bytes: Uint8Array): [number, number] {
  let a = 0x9747b28c ^ bytes.length;
  let b = 0x165667b1 + bytes.length;
  const whole = bytes.length >>> 2;
  // Whole words straight from memory where they line up, as most chunks do.
  const words =
    bytes.byteOffset % 4 === 0 ? new Uint32Array(bytes.buffer, bytes.byteOffset, whole) : null;
  for (let w = 0; w < whole; w++) {
    const at = w << 2;
    const k = words
      ? (words[w] as number) | 0
      : (bytes[at] as number) |
        ((bytes[at + 1] as number) << 8) |
        ((bytes[at + 2] as number) << 16) |
        ((bytes[at + 3] as number) << 24) |
        0;
    let m = Math.imul(k, 0xcc9e2d51);
    m = (m << 15) | (m >>> 17);
    a ^= Math.imul(m, 0x1b873593);
    a = (a << 13) | (a >>> 19);
    a = (Math.imul(a, 5) + 0xe6546b64) | 0;
    b = (b + Math.imul(k, 0x85ebca77)) | 0;
    b = Math.imul((b << 13) | (b >>> 19), 0x9e3779b1);
  }
  for (let i = whole << 2; i < bytes.length; i++) {
    const k = (bytes[i] as number) | 0x100;
    a = Math.imul(a ^ k, 0x01000193);
    b = Math.imul((b + k) | 0, 0x9e3779b1);
  }
  a ^= a >>> 16;
  a = Math.imul(a, 0x85ebca6b);
  a ^= a >>> 13;
  b ^= b >>> 15;
  b = Math.imul(b, 0xc2b2ae3d);
  b ^= b >>> 16;
  return [a >>> 0, b >>> 0];
}

export type SaveResult = { chunksWritten: number; bytesWritten: number };

export class ChunkedFile {
  private manifest: Manifest | null = null;
  // The fingerprint of each chunk the manifest names, two numbers each, to compare the next save with.
  private prints = new Uint32Array(0);
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
    // A few reads at a time: one after another, each waits for the file system (M106).
    for (let from = 0; from < manifest.chunks.length; from += READS_AT_ONCE) {
      const names = manifest.chunks.slice(from, from + READS_AT_ONCE);
      const read = await Promise.all(names.map((name) => this.store.read(name)));
      for (const [j, chunk] of read.entries()) {
        const i = from + j;
        const start = i * manifest.chunkBytes;
        const length = Math.min(manifest.chunkBytes, manifest.size - start);
        if (!chunk || chunk.length !== length) throw new Error(`The saved library lost part ${i}.`);
        bytes.set(chunk, start);
      }
    }
    // A manifest made with another chunk size is rewritten in full on the next save.
    if (manifest.chunkBytes === this.chunkBytes) {
      this.manifest = manifest;
      this.prints = new Uint32Array(manifest.chunks.length * 2);
      for (let i = 0; i < manifest.chunks.length; i++) {
        const start = i * this.chunkBytes;
        this.remember(i, bytes.subarray(start, start + this.chunkBytes));
      }
    }
    return bytes;
  }

  /** Writes the chunks that differ from the last load or save, then the manifest. */
  async save(bytes: Uint8Array): Promise<SaveResult> {
    const previous = this.manifest;
    const generation = this.generation + 1;
    const chunks = chunksOf(bytes, this.chunkBytes);
    const names: string[] = [];
    const prints = new Uint32Array(chunks.length * 2);
    let bytesWritten = 0;
    let chunksWritten = 0;
    for (const [i, chunk] of chunks.entries()) {
      const old = previous?.chunks[i];
      const [a, b] = chunkPrint(chunk);
      prints[i * 2] = a;
      prints[i * 2 + 1] = b;
      // The length is part of the print: a last chunk that shrank or grew is a new file.
      if (old !== undefined && this.prints[i * 2] === a && this.prints[i * 2 + 1] === b) {
        names.push(old);
      } else {
        const name = `${i}.${generation}`;
        await this.store.write(name, chunk);
        names.push(name);
        bytesWritten += chunk.length;
        chunksWritten++;
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
    this.prints = prints;
    this.generation = generation;
    await this.prune();
    return { chunksWritten, bytesWritten };
  }

  private remember(i: number, chunk: Uint8Array): void {
    const [a, b] = chunkPrint(chunk);
    this.prints[i * 2] = a;
    this.prints[i * 2 + 1] = b;
  }

  /** Removes chunk files the manifest no longer names, such as those of a save cut short. */
  private async prune(): Promise<void> {
    const keep = new Set([MANIFEST, ...(this.manifest?.chunks ?? [])]);
    for (const name of await this.store.list()) {
      if (!keep.has(name)) await this.store.remove(name);
    }
  }
}
