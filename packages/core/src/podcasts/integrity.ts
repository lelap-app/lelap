/**
 * `podcast:integrity` for the web app's downloads (M121): Subresource Integrity hashes
 * (`sha256-…`), checked over the parts of a file as they are written. Web Crypto only hashes a
 * whole buffer, which for a 100 MB episode would mean reading it all into memory, so SHA-256,
 * SHA-384 and SHA-512 are here in JavaScript, fed block by block. The phone checks in the
 * download module (`Integrity` in `modules/download`); both take the strongest algorithm given.
 */

// The hash rounds index fixed-size typed arrays within their bounds, in a loop that runs for
// every 64 bytes of an episode: no fallbacks there.
/* eslint-disable @typescript-eslint/no-non-null-assertion */

export type SriAlgorithm = 'sha256' | 'sha384' | 'sha512';

// Strongest first: SRI checks only the strongest algorithm a value names.
const ALGORITHMS: SriAlgorithm[] = ['sha512', 'sha384', 'sha256'];

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64, also the URL-safe kind; null for anything else. Core has no `atob` on every target. */
function decodeBase64(text: string): Uint8Array | null {
  const chars = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (chars.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((chars.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of chars) {
    const n = BASE64.indexOf(char);
    if (n < 0) return null;
    value = ((value << 6) | n) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

/** The strongest algorithm in `sri` with its expected digests; null when none is known. */
export function parseSri(sri: string): { algorithm: SriAlgorithm; digests: Uint8Array[] } | null {
  const tokens: { name: string; bytes: Uint8Array }[] = [];
  for (const token of sri.trim().split(/\s+/)) {
    const dash = token.indexOf('-');
    if (dash <= 0) continue;
    // Options after `?` are reserved by the spec and ignored.
    const bytes = decodeBase64(token.slice(dash + 1).split('?')[0] ?? '');
    if (bytes && bytes.length > 0) tokens.push({ name: token.slice(0, dash).toLowerCase(), bytes });
  }
  for (const algorithm of ALGORITHMS) {
    const digests = tokens.filter((t) => t.name === algorithm).map((t) => t.bytes);
    if (digests.length > 0) return { algorithm, digests };
  }
  return null;
}

export type Digest = { update(bytes: Uint8Array): void; digest(): Uint8Array };

/** An incremental hash: `update` with the bytes in order, then `digest` once. */
export function createDigest(algorithm: SriAlgorithm): Digest {
  return algorithm === 'sha256' ? new Sha256() : new Sha512(algorithm === 'sha384');
}

/**
 * A check of a file against its SRI value, fed as the file is written; null when the value names
 * no algorithm this knows, so the file is kept unchecked.
 */
export function integrityCheck(
  sri: string,
): { update(bytes: Uint8Array): void; matches(): boolean } | null {
  const expected = parseSri(sri);
  if (!expected) return null;
  const hash = createDigest(expected.algorithm);
  return {
    update: (bytes) => hash.update(bytes),
    matches: () => {
      const actual = hash.digest();
      return expected.digests.some(
        (d) => d.length === actual.length && d.every((b, i) => b === actual[i]),
      );
    },
  };
}

// The round constants and first hashes are the fractional parts of the cube and square roots of
// the first primes; computed once, so no hand-copied table can hold a typo.
function primes(count: number): bigint[] {
  const found: bigint[] = [];
  for (let n = 2; found.length < count; n++) {
    if (found.every((p) => BigInt(n) % p !== 0n)) found.push(BigInt(n));
  }
  return found;
}

function iroot(value: bigint, k: bigint): bigint {
  // Newton's method from above, on integers.
  let x = 1n << (BigInt(value.toString(2).length) / k + 1n);
  for (;;) {
    const next = ((k - 1n) * x + value / x ** (k - 1n)) / k;
    if (next >= x) return x;
    x = next;
  }
}

/** The first `bits` bits of the fractional part of the `k`th root of each prime. */
function fractions(ps: bigint[], k: bigint, bits: bigint): bigint[] {
  const mask = (1n << bits) - 1n;
  return ps.map((p) => iroot(p << (bits * k), k) & mask);
}

type Tables = {
  k256: Uint32Array;
  h256: Uint32Array;
  k512: Uint32Array;
  h512: Uint32Array;
  h384: Uint32Array;
};
let tables: Tables | null = null;

// 64-bit values are kept as pairs of 32-bit halves, high first.
const split64 = (values: bigint[]) =>
  Uint32Array.from(values.flatMap((v) => [Number(v >> 32n), Number(v & 0xffffffffn)]));

function constants(): Tables {
  if (tables) return tables;
  const ps = primes(80);
  tables = {
    k256: Uint32Array.from(fractions(ps.slice(0, 64), 3n, 32n).map(Number)),
    h256: Uint32Array.from(fractions(ps.slice(0, 8), 2n, 32n).map(Number)),
    k512: split64(fractions(ps, 3n, 64n)),
    h512: split64(fractions(ps.slice(0, 8), 2n, 64n)),
    h384: split64(fractions(ps.slice(8, 16), 2n, 64n)),
  };
  return tables;
}

abstract class BlockHash implements Digest {
  private readonly buffer: Uint8Array;
  private filled = 0;
  private length = 0;
  private done = false;
  private readonly blockSize: number;

  constructor(blockSize: number) {
    this.blockSize = blockSize;
    this.buffer = new Uint8Array(blockSize);
  }

  protected abstract compress(block: Uint8Array, at: number): void;
  protected abstract output(): Uint8Array;

  update(bytes: Uint8Array): void {
    if (this.done) throw new Error('The hash was already read');
    this.length += bytes.length;
    let at = 0;
    if (this.filled > 0) {
      const take = Math.min(bytes.length, this.blockSize - this.filled);
      this.buffer.set(bytes.subarray(0, take), this.filled);
      this.filled += take;
      at = take;
      if (this.filled < this.blockSize) return;
      this.compress(this.buffer, 0);
      this.filled = 0;
    }
    for (; at + this.blockSize <= bytes.length; at += this.blockSize) this.compress(bytes, at);
    this.buffer.set(bytes.subarray(at), 0);
    this.filled = bytes.length - at;
  }

  digest(): Uint8Array {
    if (this.done) throw new Error('The hash was already read');
    this.done = true;
    // Padding: a 1 bit, zeros, then the length in bits in the block's last 8 (or 16) bytes.
    const lengthBytes = this.blockSize / 8;
    const tail = new Uint8Array(
      this.filled + 1 + lengthBytes <= this.blockSize ? this.blockSize : this.blockSize * 2,
    );
    tail.set(this.buffer.subarray(0, this.filled));
    tail[this.filled] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(this.length / 0x20000000));
    view.setUint32(tail.length - 4, (this.length % 0x20000000) * 8);
    for (let at = 0; at < tail.length; at += this.blockSize) this.compress(tail, at);
    return this.output();
  }
}

const word = (b: Uint8Array, j: number) =>
  ((b[j]! << 24) | (b[j + 1]! << 16) | (b[j + 2]! << 8) | b[j + 3]!) >>> 0;

function bytesOf(words: Uint32Array, count: number): Uint8Array {
  const out = new Uint8Array(count * 4);
  const view = new DataView(out.buffer);
  for (let i = 0; i < count; i++) view.setUint32(i * 4, words[i]!);
  return out;
}

class Sha256 extends BlockHash {
  private readonly h: Uint32Array;
  private readonly w = new Uint32Array(64);
  private readonly k: Uint32Array;

  constructor() {
    super(64);
    const c = constants();
    this.h = c.h256.slice();
    this.k = c.k256;
  }

  protected compress(b: Uint8Array, at: number): void {
    const { w, h, k } = this;
    for (let i = 0; i < 16; i++) w[i] = word(b, at + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!,
      bb = h[1]!,
      c = h[2]!,
      d = h[3]!,
      e = h[4]!,
      f = h[5]!,
      g = h[6]!,
      hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[i]! + w[i]!) | 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = bb;
      bb = a;
      a = (t1 + t2) | 0;
    }
    h[0] = h[0]! + a;
    h[1] = h[1]! + bb;
    h[2] = h[2]! + c;
    h[3] = h[3]! + d;
    h[4] = h[4]! + e;
    h[5] = h[5]! + f;
    h[6] = h[6]! + g;
    h[7] = h[7]! + hh;
  }

  protected output(): Uint8Array {
    return bytesOf(this.h, 8);
  }
}

const TWO_32 = 0x100000000;

class Sha512 extends BlockHash {
  private readonly h: Uint32Array;
  private readonly w = new Uint32Array(160);
  private readonly k: Uint32Array;
  private readonly short: boolean;

  constructor(short: boolean) {
    super(128);
    this.short = short;
    const c = constants();
    this.h = (short ? c.h384 : c.h512).slice();
    this.k = c.k512;
  }

  protected compress(b: Uint8Array, at: number): void {
    const { w, h, k } = this;
    for (let i = 0; i < 32; i++) w[i] = word(b, at + i * 4);
    for (let i = 16; i < 80; i++) {
      let hi = w[2 * (i - 15)]!;
      let lo = w[2 * (i - 15) + 1]!;
      // σ0: rotate 1, rotate 8, shift 7.
      const s0h = ((hi >>> 1) | (lo << 31)) ^ ((hi >>> 8) | (lo << 24)) ^ (hi >>> 7);
      const s0l = ((lo >>> 1) | (hi << 31)) ^ ((lo >>> 8) | (hi << 24)) ^ ((lo >>> 7) | (hi << 25));
      hi = w[2 * (i - 2)]!;
      lo = w[2 * (i - 2) + 1]!;
      // σ1: rotate 19, rotate 61, shift 6.
      const s1h = ((hi >>> 19) | (lo << 13)) ^ ((lo >>> 29) | (hi << 3)) ^ (hi >>> 6);
      const s1l =
        ((lo >>> 19) | (hi << 13)) ^ ((hi >>> 29) | (lo << 3)) ^ ((lo >>> 6) | (hi << 26));
      const sumLo = (s0l >>> 0) + (s1l >>> 0) + w[2 * (i - 7) + 1]! + w[2 * (i - 16) + 1]!;
      w[2 * i] = s0h + s1h + w[2 * (i - 7)]! + w[2 * (i - 16)]! + Math.floor(sumLo / TWO_32);
      w[2 * i + 1] = sumLo;
    }
    let ah = h[0]!,
      al = h[1]!,
      bh = h[2]!,
      bl = h[3]!,
      ch = h[4]!,
      cl = h[5]!,
      dh = h[6]!,
      dl = h[7]!;
    let eh = h[8]!,
      el = h[9]!,
      fh = h[10]!,
      fl = h[11]!,
      gh = h[12]!,
      gl = h[13]!,
      hh = h[14]!,
      hl = h[15]!;
    for (let i = 0; i < 80; i++) {
      // Σ1(e): rotate 14, 18 and 41.
      const s1h =
        ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const s1l =
        ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      const t1l = hl + (s1l >>> 0) + (chl >>> 0) + k[2 * i + 1]! + w[2 * i + 1]!;
      const t1h = hh + s1h + chh + k[2 * i]! + w[2 * i]! + Math.floor(t1l / TWO_32);
      // Σ0(a): rotate 28, 34 and 39.
      const s0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const s0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2l = (s0l >>> 0) + (majl >>> 0);
      const t2h = s0h + majh + Math.floor(t2l / TWO_32);
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      const el2 = dl + (t1l >>> 0);
      eh = (dh + t1h + Math.floor(el2 / TWO_32)) >>> 0;
      el = el2 >>> 0;
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      const al2 = (t1l >>> 0) + (t2l >>> 0);
      ah = (t1h + t2h + Math.floor(al2 / TWO_32)) >>> 0;
      al = al2 >>> 0;
    }
    const add = (i: number, hi: number, lo: number) => {
      const sum = h[i + 1]! + lo;
      h[i] = h[i]! + hi + Math.floor(sum / TWO_32);
      h[i + 1] = sum;
    };
    add(0, ah, al);
    add(2, bh, bl);
    add(4, ch, cl);
    add(6, dh, dl);
    add(8, eh, el);
    add(10, fh, fl);
    add(12, gh, gl);
    add(14, hh, hl);
  }

  protected output(): Uint8Array {
    return bytesOf(this.h, this.short ? 12 : 16);
  }
}
