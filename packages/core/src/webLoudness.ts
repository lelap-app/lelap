import { byte, id3v2Size, syncsafe } from './webSilence';

/**
 * Even loudness for the web player (M101), as the Android service does it (`ReplayGain.kt` and
 * `Leveller` in modules/audio): the file's ReplayGain when its tags have one, otherwise a light
 * measured gain. Keep the numbers in step with the Kotlin side.
 */
export const LOUDNESS_RULES = {
  /** About -18 LUFS for speech, the level ReplayGain 2 aims at too. */
  targetDb: -20,
  /** Quieter blocks are pauses and room noise, which must not pull the gain up. */
  gateDb: -50,
  blockMs: 400,
  averageBlocks: 25,
  maxLiftDb: 10,
  maxCutDb: 10,
  /** The gain glides towards its target with this time constant. */
  glideS: 1.5,
};

const TAG_LIMIT_DB = 20;
/** Opus's R128 gains aim at -23 LUFS, ReplayGain 2 at -18. */
const R128_TO_REPLAYGAIN_DB = 5;
const DECIBELS = /^\s*([+-]?\d+(?:\.\d+)?)\s*(?:dB)?\s*$/i;

/**
 * The gain in dB from a file's tags, or null when they carry none. The album gain comes first:
 * a book's parts then keep the level they were mastered at against each other.
 */
export function replayGainDb(tags: [string, string][]): number | null {
  const byName = new Map(tags.map(([name, value]) => [name.trim().toUpperCase(), value]));
  const decibels = (value: string | undefined) => {
    const match = value === undefined ? null : DECIBELS.exec(value);
    const db = match ? Number(match[1]) : NaN;
    return Number.isFinite(db) && Math.abs(db) <= TAG_LIMIT_DB ? db : null;
  };
  // A Q7.8 number: 256 is 1 dB.
  const r128 = (value: string | undefined) => {
    const q78 = value === undefined || !/^\s*[+-]?\d+\s*$/.test(value) ? NaN : Number(value);
    const db = q78 / 256 + R128_TO_REPLAYGAIN_DB;
    return Number.isFinite(db) && Math.abs(db) <= TAG_LIMIT_DB ? db : null;
  };
  return (
    decibels(byName.get('REPLAYGAIN_ALBUM_GAIN')) ??
    decibels(byName.get('REPLAYGAIN_TRACK_GAIN')) ??
    r128(byName.get('R128_ALBUM_GAIN')) ??
    r128(byName.get('R128_TRACK_GAIN'))
  );
}

/** How many bytes from the start hold a file's tags, so the player reads no more. */
export const TAG_READ_BYTES = 256 * 1024;

/**
 * Name and value tags from the first bytes of a file: ID3v2 `TXXX` frames (MP3), Vorbis comments
 * (FLAC, Ogg Vorbis, Opus) and MP4 freeform atoms when the `moov` box comes first.
 */
export function readTags(bytes: Uint8Array): [string, string][] {
  const text = ascii(bytes, 0, 4);
  if (text.startsWith('ID3')) return id3Tags(bytes);
  if (text === 'fLaC') return flacTags(bytes);
  if (text === 'OggS') return oggTags(bytes);
  if (ascii(bytes, 4, 8) === 'ftyp') return mp4Tags(bytes);
  return [];
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.length)));
}

const u32be = (b: Uint8Array, at: number) =>
  ((byte(b, at) << 24) | (byte(b, at + 1) << 16) | (byte(b, at + 2) << 8) | byte(b, at + 3)) >>> 0;
const u32le = (b: Uint8Array, at: number) =>
  (byte(b, at) | (byte(b, at + 1) << 8) | (byte(b, at + 2) << 16) | (byte(b, at + 3) << 24)) >>> 0;

function id3Tags(bytes: Uint8Array): [string, string][] {
  const major = byte(bytes, 3);
  // Whole-tag unsynchronisation (ID3v2.3) is rare in practice and left out.
  if ((major !== 3 && major !== 4) || byte(bytes, 5) & 0x80) return [];
  const end = Math.min(bytes.length, id3v2Size(bytes));
  let at = 10;
  if (byte(bytes, 5) & 0x40) at += major === 4 ? syncsafe(bytes, 10) : u32be(bytes, 10) + 4;
  const tags: [string, string][] = [];
  while (at + 10 <= end) {
    const id = ascii(bytes, at, at + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = major === 4 ? syncsafe(bytes, at + 4) : u32be(bytes, at + 4);
    const body = bytes.subarray(at + 10, Math.min(end, at + 10 + size));
    if (id === 'TXXX' && body.length > 1) {
      const [description, value] = id3Text(body.subarray(1), byte(body, 0));
      if (description !== undefined) tags.push([description, value ?? '']);
    }
    at += 10 + size;
  }
  return tags;
}

/** The null-separated strings of an ID3 text frame in its encoding. */
function id3Text(bytes: Uint8Array, encoding: number): string[] {
  const wide = encoding === 1 || encoding === 2;
  const decode = (b: Uint8Array) =>
    encoding === 3 ? utf8(b) : encoding === 2 ? utf16(b, true) : wide ? utf16(b, null) : latin1(b);
  const parts: string[] = [];
  let start = 0;
  const step = wide ? 2 : 1;
  for (let i = 0; i + step <= bytes.length; i += step) {
    if (bytes[i] === 0 && (!wide || bytes[i + 1] === 0)) {
      parts.push(decode(bytes.subarray(start, i)));
      start = i + step;
    }
  }
  if (start < bytes.length) parts.push(decode(bytes.subarray(start)));
  return parts.map((p) => p.replace(/^\uFEFF/, ''));
}

// Text decoded by hand: core is also type-checked for native modules, without DOM types.
const latin1 = (b: Uint8Array) => String.fromCharCode(...b);

/** UTF-16 with a byte order mark when `bigEndian` is null. */
function utf16(b: Uint8Array, bigEndian: boolean | null): string {
  let at = 0;
  let big = bigEndian ?? true;
  if (bigEndian === null && b.length >= 2) {
    if (byte(b, 0) === 0xff && byte(b, 1) === 0xfe) [big, at] = [false, 2];
    else if (byte(b, 0) === 0xfe && byte(b, 1) === 0xff) at = 2;
  }
  const units: number[] = [];
  for (; at + 1 < b.length; at += 2) {
    units.push(big ? (byte(b, at) << 8) | byte(b, at + 1) : byte(b, at) | (byte(b, at + 1) << 8));
  }
  return String.fromCharCode(...units);
}

function utf8(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length;) {
    const c = byte(b, i);
    const extra = c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : c >= 0xc0 ? 1 : 0;
    let code = extra === 0 ? c : c & (0x3f >> extra);
    for (let k = 1; k <= extra; k++) code = (code << 6) | (byte(b, i + k) & 0x3f);
    out += String.fromCodePoint(code);
    i += extra + 1;
  }
  return out;
}

/** A Vorbis comment block: vendor, then `NAME=value` lines, little-endian lengths. */
function vorbisComments(bytes: Uint8Array): [string, string][] {
  if (bytes.length < 8) return [];
  let at = 4 + u32le(bytes, 0);
  if (at + 4 > bytes.length) return [];
  const count = u32le(bytes, at);
  at += 4;
  const tags: [string, string][] = [];
  for (let i = 0; i < count && at + 4 <= bytes.length; i++) {
    const length = u32le(bytes, at);
    const line = utf8(bytes.subarray(at + 4, at + 4 + length));
    at += 4 + length;
    const equals = line.indexOf('=');
    if (equals > 0) tags.push([line.slice(0, equals), line.slice(equals + 1)]);
  }
  return tags;
}

function flacTags(bytes: Uint8Array): [string, string][] {
  let at = 4;
  while (at + 4 <= bytes.length) {
    const header = byte(bytes, at);
    const length = (byte(bytes, at + 1) << 16) | (byte(bytes, at + 2) << 8) | byte(bytes, at + 3);
    if ((header & 0x7f) === 4) return vorbisComments(bytes.subarray(at + 4, at + 4 + length));
    if (header & 0x80) break;
    at += 4 + length;
  }
  return [];
}

/** The second packet of an Ogg stream holds the comments, after `\x03vorbis` or `OpusTags`. */
function oggTags(bytes: Uint8Array): [string, string][] {
  const packets: number[][] = [[]];
  let at = 0;
  while (at + 27 <= bytes.length && ascii(bytes, at, at + 4) === 'OggS' && packets.length < 3) {
    const segments = byte(bytes, at + 26);
    let body = at + 27 + segments;
    for (let i = 0; i < segments; i++) {
      const lace = byte(bytes, at + 27 + i);
      packets[packets.length - 1]?.push(...bytes.subarray(body, body + lace));
      body += lace;
      // A lace under 255 ends the packet.
      if (lace < 255) packets.push([]);
    }
    at = body;
  }
  const comment = Uint8Array.from(packets[1] ?? []);
  if (ascii(comment, 0, 8) === 'OpusTags') return vorbisComments(comment.subarray(8));
  if (comment[0] === 3 && ascii(comment, 1, 7) === 'vorbis') {
    return vorbisComments(comment.subarray(7));
  }
  return [];
}

/** Freeform `----` atoms under moov/udta/meta/ilst, named by their `name` box. */
function mp4Tags(bytes: Uint8Array): [string, string][] {
  const tags: [string, string][] = [];
  const walk = (from: number, to: number, path: string) => {
    let at = from;
    while (at + 8 <= to) {
      const size = u32be(bytes, at);
      const type = ascii(bytes, at + 4, at + 8);
      const end = size >= 8 ? Math.min(to, at + size) : to;
      if (path === '' && type === 'moov') walk(at + 8, end, 'moov');
      else if (path === 'moov' && type === 'udta') walk(at + 8, end, 'udta');
      // `meta` is a full box: four bytes of version and flags first.
      else if (path === 'udta' && type === 'meta') walk(at + 12, end, 'meta');
      else if (path === 'meta' && type === 'ilst') walk(at + 8, end, 'ilst');
      else if (path === 'ilst' && type === '----') {
        let name: string | null = null;
        let value: string | null = null;
        let inner = at + 8;
        while (inner + 8 <= end) {
          const innerSize = u32be(bytes, inner);
          const innerType = ascii(bytes, inner + 4, inner + 8);
          if (innerSize < 8) break;
          if (innerType === 'name') {
            name = utf8(bytes.subarray(inner + 12, inner + innerSize));
          }
          if (innerType === 'data') {
            value = utf8(bytes.subarray(inner + 16, inner + innerSize));
          }
          inner += innerSize;
        }
        if (name !== null && value !== null) tags.push([name, value]);
      }
      if (size < 8) break;
      at += size;
    }
  };
  walk(0, bytes.length, '');
  return tags;
}

/**
 * The measured level of what plays: blocks of about 400 ms with sound in them, a plain mean over
 * the first ones so it settles fast, then a moving one of about 10 s.
 */
export class Loudness {
  private blocks = 0;
  private db: number | null = null;

  constructor(private readonly rules = LOUDNESS_RULES) {}

  get levelDb(): number | null {
    return this.db;
  }

  /** Adds one block's mean square. */
  add(meanSquare: number): void {
    const blockDb = 10 * Math.log10(Math.max(meanSquare, 1e-12));
    if (blockDb <= this.rules.gateDb) return;
    this.blocks++;
    const weight = Math.max(1 / this.blocks, 1 / this.rules.averageBlocks);
    this.db = this.db === null ? blockDb : this.db + (blockDb - this.db) * weight;
  }

  /** A new book or episode is measured from scratch. */
  forget(): void {
    this.blocks = 0;
    this.db = null;
  }
}

/** The gain even loudness glides towards: the tag's when there is one, else the measured one. */
export function levelTargetDb(
  tagGainDb: number | null,
  levelDb: number | null,
  rules = LOUDNESS_RULES,
): number {
  const clamp = (db: number) => Math.min(rules.maxLiftDb, Math.max(-rules.maxCutDb, db));
  if (tagGainDb !== null) return clamp(tagGainDb);
  return levelDb === null ? 0 : clamp(rules.targetDb - levelDb);
}
