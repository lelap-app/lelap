import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * A big file kept as fixed-size chunk files plus a manifest, so a save writes only the chunks
 * that changed. The web app keeps its SQLite database this way in the origin private file system
 * (M67): writing the whole file after each change is 49 MB at 10,000 books.
 *
 * A changed chunk goes to a new file name, and the manifest names the current file of each chunk.
 * Writing the manifest is the commit: a save cut short leaves the old manifest and its chunks
 * whole, and the next save clears the strays.
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

/** A digest of a chunk; equal digests mean equal bytes. */
export type Digest = (bytes: Uint8Array) => Promise<string>;

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

export type SaveResult = { chunksWritten: number; bytesWritten: number };

export class ChunkedFile {
  private manifest: Manifest | null = null;
  private digests: string[] = [];
  // Never reused, so a save never overwrites a file the current manifest names.
  private generation = 0;

  constructor(
    private readonly store: ChunkStore,
    private readonly digest: Digest,
    private readonly chunkBytes = CHUNK_BYTES,
  ) {}

  /** The saved bytes, or null when nothing was saved yet. Throws when a chunk is missing. */
  async load(): Promise<Uint8Array | null> {
    const raw = await this.store.read(MANIFEST);
    const manifest = raw ? parseManifest(raw) : null;
    if (!manifest) return null;
    this.generation = manifest.generation;
    const bytes = new Uint8Array(manifest.size);
    const digests: string[] = [];
    for (const [i, name] of manifest.chunks.entries()) {
      const chunk = await this.store.read(name);
      const start = i * manifest.chunkBytes;
      const length = Math.min(manifest.chunkBytes, manifest.size - start);
      if (!chunk || chunk.length !== length) throw new Error(`The saved library lost part ${i}.`);
      bytes.set(chunk, start);
      digests.push(await this.digest(chunk));
    }
    // A manifest made with another chunk size is rewritten in full on the next save.
    if (manifest.chunkBytes === this.chunkBytes) {
      this.manifest = manifest;
      this.digests = digests;
    }
    return bytes;
  }

  /** Writes the chunks that differ from the last load or save, then the manifest. */
  async save(bytes: Uint8Array): Promise<SaveResult> {
    const previous = this.manifest;
    const generation = this.generation + 1;
    const chunks = chunksOf(bytes, this.chunkBytes);
    const names: string[] = [];
    const digests: string[] = [];
    let bytesWritten = 0;
    let chunksWritten = 0;
    for (const [i, chunk] of chunks.entries()) {
      const digest = await this.digest(chunk);
      const old = previous?.chunks[i];
      if (old !== undefined && this.digests[i] === digest) {
        names.push(old);
      } else {
        const name = `${i}.${generation}`;
        await this.store.write(name, chunk);
        names.push(name);
        bytesWritten += chunk.length;
        chunksWritten++;
      }
      digests.push(digest);
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
    this.digests = digests;
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

/** SHA-256 in plain JavaScript, for pages without `crypto.subtle` (plain http on a home network). */
export const sha256Digest: Digest = (bytes) => Promise.resolve(bytesToHex(sha256(bytes)));
