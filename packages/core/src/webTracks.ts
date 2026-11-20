/**
 * Where the sound sits in a file, for skip silence on the web (M122): the packets of MP4 and M4B
 * (AAC), Ogg (Opus, Vorbis) and FLAC files and of variable-bitrate MP3s, and the time they play
 * at, so a few seconds read from anywhere in the file land on the right place in the pause map.
 * Constant-bitrate MP3s keep their even byte-to-time layout (`mp3Layout`, M101).
 */
import {
  byte,
  findMp3Frame,
  id3v2Size,
  type Mp3Layout,
  mp3ByteAt,
  mp3FrameAt,
  mp3Layout,
  mp3MsAt,
} from './webSilence';

/** One coded packet: `at` bytes into the run's data, `size` long. */
export type TrackPacket = { at: number; size: number };

/**
 * Packets found in bytes read from somewhere in the file, and where their decoded sound belongs.
 * It starts at `startMs` (MP3 frames, decoded whole with `decodeAudioData`) or ends at `endMs`
 * (the packets' tables or pages say where the last one ends).
 */
export type TrackRun = {
  packets: TrackPacket[];
  /** The packets' bytes when they had to be copied out of their pages; else the bytes read. */
  data?: Uint8Array;
  startMs?: number;
  endMs?: number;
  /** Sound at the start to leave out: a decoder that starts mid-file needs a moment to settle. */
  skipMs: number;
  /** Sound at the end to leave out: a last MP3 frame may be cut short. */
  dropMs: number;
};

/** What WebCodecs' `AudioDecoder` needs. Null on a track: `decodeAudioData` decodes it. */
export type TrackDecoder = {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: Uint8Array;
};

export type TrackKind = 'mp3' | 'vbr-mp3' | 'mp4' | 'ogg' | 'flac';

export type WebTrack = {
  kind: TrackKind;
  decoder: TrackDecoder | null;
  sampleRate: number;
  /** The bytes to read for the sound from `fromMs` on, `spanMs` long, with some before it. */
  range(fromMs: number, spanMs: number): { start: number; end: number };
  /** The whole packets in `bytes`, read from byte `start`; null when there are none. */
  run(bytes: Uint8Array, start: number): TrackRun | null;
  /**
   * The element seeked to `toMs`. True when the element's time now counts from somewhere else in
   * the file, so the pauses found so far no longer line up (a variable-bitrate MP3, M134).
   */
  seeked?(toMs: number): boolean;
};

/** Leaves out this much at the start of a run that doesn't start the file. */
const SETTLE_MS = 100;

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));

const u16 = (b: Uint8Array, at: number) => (byte(b, at) << 8) | byte(b, at + 1);
const u32 = (b: Uint8Array, at: number) => u16(b, at) * 65_536 + u16(b, at + 2);
const u32le = (b: Uint8Array, at: number) =>
  byte(b, at) + byte(b, at + 1) * 256 + byte(b, at + 2) * 65_536 + byte(b, at + 3) * 16_777_216;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** What the start of a file says about where its sound lies, before anything is decoded. */
export type TrackHead =
  | { kind: 'mp3'; layout: Mp3Layout }
  | { kind: 'vbr-mp3'; audioStart: number; frame: Mp3FrameInfo; xing: XingInfo | null }
  | { kind: 'mp4'; moov: { at: number; size: number | null } }
  | { kind: 'ogg' }
  | { kind: 'flac'; info: FlacInfo };

export type Mp3FrameInfo = { sampleRate: number; samplesPerFrame: number; delayMs: number };

/** What kind of file this is and where its sound starts, from its first bytes; null if unknown. */
export function trackHead(head: Uint8Array, size: number | null): TrackHead | null {
  if (ascii(head, 4, 4) === 'ftyp') {
    const moov = mp4Moov(head, size);
    return moov ? { kind: 'mp4', moov } : null;
  }
  if (ascii(head, 0, 4) === 'OggS') return { kind: 'ogg' };
  const tag = id3v2Size(head);
  if (ascii(head, tag, 4) === 'fLaC') {
    const info = flacInfo(head, tag);
    return info ? { kind: 'flac', info } : null;
  }
  const layout = mp3Layout(head, tag);
  if (layout) return { kind: 'mp3', layout };
  const at = findMp3Frame(head, tag);
  const frame = at === null ? null : mp3FrameAt(head, at);
  if (at === null || !frame || at - tag > 4096) return null;
  const xing = xingInfo(head, at);
  return {
    kind: 'vbr-mp3',
    // The Xing or VBRI frame holds no sound.
    audioStart: xing ? at + frame.bytes : at,
    frame: {
      sampleRate: frame.sampleRate,
      samplesPerFrame: frame.samplesPerFrame,
      delayMs: xing?.delayMs ?? 0,
    },
    xing,
  };
}

// ---------------------------------------------------------------------------------------------
// Guessing bytes from times, for files without a table of where each moment is

/**
 * Byte places where a known moment starts, learnt as chunks are decoded. Times between are
 * guessed in a straight line; a guess that turns out late is corrected by the next chunk.
 */
export class ByteClock {
  private points: { ms: number; at: number }[] = [];

  constructor(start: number, size: number | null, durationMs: number) {
    this.points.push({ ms: 0, at: start });
    if (size && durationMs > 0) this.points.push({ ms: durationMs, at: size });
  }

  learn(ms: number, at: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const points = this.points.filter((p) => Math.abs(p.ms - ms) > 500);
    points.push({ ms, at });
    points.sort((a, b) => a.ms - b.ms);
    this.points = points;
  }

  /** About where `ms` starts. */
  byteAt(ms: number): number {
    const points = this.points;
    let i = 0;
    while (i < points.length - 2 && (points[i + 1]?.ms ?? 0) <= ms) i++;
    const a = points[i] ?? { ms: 0, at: 0 };
    const b = points[i + 1];
    // One point only: 16 kB a second until the first chunk says better.
    const perMs = b && b.ms > a.ms ? (b.at - a.at) / (b.ms - a.ms) : 16;
    return Math.max(points[0]?.at ?? 0, Math.round(a.at + (ms - a.ms) * perMs));
  }
}

/**
 * Bytes for `spanMs` from `fromMs`, starting `leadMs` early in case the guess is late, and a
 * page or frame (`unitBytes`, at most) earlier: the first one in the bytes is cut and left out.
 */
function guessRange(
  clock: ByteClock,
  fromMs: number,
  spanMs: number,
  leadMs: number,
  unitBytes: number,
) {
  const start = Math.max(0, clock.byteAt(Math.max(0, fromMs - leadMs)) - unitBytes);
  const end = clock.byteAt(fromMs + spanMs + leadMs);
  return { start, end: Math.max(end, start + 2 * unitBytes) };
}

// ---------------------------------------------------------------------------------------------
// MP3: constant bitrate (M101) and variable bitrate

/** MP3 frames borrow bits from earlier ones: two are decoded first and left out. */
const MP3_WARM_UP = 2;

/** A constant-bitrate MP3: its bytes map evenly onto time. */
export function mp3Track(layout: Mp3Layout): WebTrack {
  const frameMs = (layout.samplesPerFrame / layout.sampleRate) * 1000;
  const warmUp = MP3_WARM_UP * layout.frameBytes;
  return {
    kind: 'mp3',
    decoder: null,
    sampleRate: layout.sampleRate,
    range(fromMs, spanMs) {
      // Two frames more than the warm-up (the first whole frame may come a frame in), so what
      // is kept starts at or before `fromMs` and the map has no gap.
      const start = Math.max(
        layout.audioStart,
        Math.floor(mp3ByteAt(layout, fromMs) - warmUp - 2 * layout.frameBytes),
      );
      return {
        start,
        end: start + Math.ceil((spanMs / 1000) * layout.bytesPerSecond + 2 * warmUp),
      };
    },
    run(bytes, start) {
      const at = findMp3Frame(bytes, 0);
      if (at === null) return null;
      return {
        packets: [{ at, size: bytes.length - at }],
        startMs: mp3MsAt(layout, start + at),
        skipMs: start + at === layout.audioStart ? 0 : MP3_WARM_UP * frameMs,
        dropMs: frameMs,
      };
    },
  };
}

/**
 * The Xing header of an MP3: its frames and bytes, its table of contents (the byte, in 256ths of
 * the file, where each hundredth of the time starts) and the LAME tag's encoder delay.
 */
export type XingInfo = {
  /** The Xing or Info frame's own length: the first audio frame follows it. */
  frameBytes: number;
  frames: number;
  bytes: number | null;
  toc: number[] | null;
  delayMs: number;
};

/** The Xing or Info header in the frame at `at`, or null. */
export function xingInfo(head: Uint8Array, at: number): XingInfo | null {
  const frame = mp3FrameAt(head, at);
  if (!frame) return null;
  const v1 = frame.samplesPerFrame === 1152;
  const mono = byte(head, at + 3) >> 6 === 3;
  const side = v1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const tagAt = at + 4 + side;
  const tag = ascii(head, tagAt, 4);
  if (tag !== 'Xing' && tag !== 'Info') return null;
  const flags = u32(head, tagAt + 4);
  let p = tagAt + 8;
  let frames = 0;
  let bytes: number | null = null;
  if (flags & 1) {
    frames = u32(head, p);
    p += 4;
  }
  if (flags & 2) {
    bytes = u32(head, p);
    p += 4;
  }
  let toc: number[] | null = null;
  if (flags & 4) {
    if (p + 100 <= head.length) toc = Array.from(head.subarray(p, p + 100));
    p += 100;
  }
  if (flags & 8) p += 4;
  let delayMs = 0;
  // Nine bytes name the encoder (`LAME3.100`); the delay sits 21 bytes in, plus the decoder's 529.
  if (p + 24 <= head.length && /^[A-Za-z]{3,4}/.test(ascii(head, p, 4))) {
    const delay = (byte(head, p + 21) << 4) | (byte(head, p + 22) >> 4);
    delayMs = ((delay + 529) / frame.sampleRate) * 1000;
  }
  return { frameBytes: frame.bytes, frames, bytes, toc, delayMs };
}

/** Where the element's time counts from: a frame's byte and the time it plays at. */
type VbrSegment = {
  /** The TOC step it came from; -1 for the file's start. */
  step: number;
  /** Where to look for the frame holding `seekByte`; the frame's own byte once found. */
  at: number;
  /** The byte the seek aimed at, until the frame holding it is found. */
  seekByte: number | null;
  /** The element's time where the segment's first frame starts. */
  ms: number;
};

/**
 * Where Chrome's time counts from after a seek to `toMs` in a variable-bitrate MP3 (M134,
 * measured in Chrome 158 against the sound playing). Its demuxer (FFmpeg's, with fast seeking)
 * goes to the table of contents' byte for the seek's whole hundredth, starts with the frame
 * holding that byte, and gives that frame the hundredth's time: so after a seek the element's
 * time can be seconds away from the frames' own. A seek before the encoder delay ends, or none,
 * keeps the file's start, where the delay is left out. Null without a table of contents.
 */
export function xingSeek(
  head: Extract<TrackHead, { kind: 'vbr-mp3' }>,
  size: number | null,
  toMs: number,
): { step: number; byte: number; ms: number } | null {
  const { xing, frame } = head;
  const fileBytes = xing?.bytes || size;
  if (!xing?.toc || !xing.frames || !fileBytes) return null;
  if (toMs < frame.delayMs) return { step: -1, byte: head.audioStart, ms: -frame.delayMs };
  const durationMs = ((xing.frames * frame.samplesPerFrame) / frame.sampleRate) * 1000;
  let step = 0;
  while (step < 99 && ((step + 1) * durationMs) / 100 <= toMs) step++;
  // Places in the table count from the end of the Xing frame.
  const byte = head.audioStart + Math.round(((xing.toc[step] ?? 0) * fileBytes) / 256);
  return { step, byte, ms: (step * durationMs) / 100 };
}

/** How a browser seeks a variable-bitrate MP3 (M134, M150). */
export type Mp3SeekRule = 'chrome' | 'firefox';

/**
 * How this browser seeks an MP3 (M134, M150): Chrome and the browsers built on it as `xingSeek`
 * describes, Firefox as `firefoxXingSeek` does. Safari wasn't measured; there variable-bitrate
 * MP3s play unchanged.
 */
export function mp3SeekRule(userAgent: string): Mp3SeekRule | null {
  // Every browser on iOS is Safari's engine underneath.
  if (/\b(FxiOS|CriOS|EdgiOS)\//.test(userAgent)) return null;
  if (/\bFirefox\//.test(userAgent)) return 'firefox';
  if (/\b(Chrome|Chromium)\//.test(userAgent)) return 'chrome';
  return null;
}

/**
 * Where Firefox's time counts from after a seek to `toMs` in a variable-bitrate MP3 (M150,
 * measured in Firefox 147 against the sound playing: of 74 seeks in six files, 73 within 15 ms
 * and one a frame off). Its
 * demuxer takes the table of contents' place for the seek's whole hundredth, without
 * interpolating, counted from the file's own start (an ID3 tag moves it), turns that into a frame
 * index from the Xing header's bytes and frames in 32-bit floats, and plays from the first frame
 * at or after that index's byte. A first guess past the seek is made again from 1 % earlier. The
 * frame it lands on gets the index's time, so the element's time can be seconds from the frames'.
 * Null without a table of contents.
 */
export function firefoxXingSeek(
  head: Extract<TrackHead, { kind: 'vbr-mp3' }>,
  toMs: number,
): { step: number; byte: number; ms: number } | null {
  const { xing, frame } = head;
  if (!xing?.toc || !xing.frames || !xing.bytes) return null;
  const { toc, frames, bytes } = xing;
  const start = { step: -1, byte: head.audioStart, ms: -frame.delayMs };
  if (toMs <= 0) return start;
  const frameMs = (frame.samplesPerFrame / frame.sampleRate) * 1000;
  const durationMs = frames * frameMs;
  // The Xing frame's own byte: the demuxer's first frame.
  const first = head.audioStart - xing.frameBytes;
  const f32 = Math.fround;
  const index = (ms: number) => {
    const step = Math.floor(Math.min(99, Math.max(0, (ms * 100) / durationMs)));
    const offset = Math.trunc(f32(f32(f32(1 / 256) * (toc[step] ?? 0)) * bytes));
    const i = Math.trunc(f32(f32(f32(offset - first) / bytes) * frames));
    return Math.max(0, Math.min(frames, i));
  };
  let i = index(toMs);
  if (i * frameMs > toMs) i = index(toMs - toMs / 100);
  if (i === 0) return start;
  return {
    step: i,
    byte: first + Math.trunc((i * bytes) / frames),
    ms: (i - 1) * frameMs - frame.delayMs,
  };
}

/** How far before a seek's byte the frame holding it is looked for. */
const SYNC_BACK = 4096;

/**
 * A variable-bitrate MP3. A frame's time is its count from where the element's time counts from
 * (the file's start, or the frame a seek landed on, [xingSeek]), so the track counts frames as
 * the file is read in order and keeps the byte of every 64th. Ahead of what has been counted,
 * `range` asks for the next bytes to count, at most 4 MB at a time.
 */
export function vbrMp3Track(
  head: Extract<TrackHead, { kind: 'vbr-mp3' }>,
  size: number | null,
  rule: Mp3SeekRule = 'chrome',
): WebTrack & { counted(): number } {
  const { frame, xing, audioStart } = head;
  const frameMs = (frame.samplesPerFrame / frame.sampleRate) * 1000;
  const average =
    xing?.bytes && xing.frames
      ? xing.bytes / xing.frames
      : size && xing?.frames
        ? (size - audioStart) / xing.frames
        : 420;
  let segment: VbrSegment = { step: -1, at: audioStart, seekByte: null, ms: -frame.delayMs };
  let marks: number[] = [audioStart];
  let counted = 0;
  let countedTo = audioStart;

  /** Finds the frame holding the seek's byte in bytes read from `start`; its offset, or null. */
  const holding = (bytes: Uint8Array, start: number, target: number): number | null => {
    for (let from = 0; from < Math.min(bytes.length, target - start + 1);) {
      const first = findMp3Frame(bytes, from);
      if (first === null || start + first > target) return null;
      let at = first;
      for (;;) {
        const info = mp3FrameAt(bytes, at);
        if (!info) break;
        // Chrome plays from the frame holding the byte, Firefox from the next to start.
        if (rule === 'firefox' ? start + at >= target : start + at + info.bytes > target) return at;
        at += info.bytes;
      }
      // The chain broke before the byte: a false sync; look again past it.
      from = first + 1;
    }
    return null;
  };

  const track: WebTrack & { counted(): number } = {
    kind: 'vbr-mp3',
    decoder: null,
    sampleRate: frame.sampleRate,
    counted: () => counted,
    seeked(toMs) {
      const place = rule === 'firefox' ? firefoxXingSeek(head, toMs) : xingSeek(head, size, toMs);
      if (!place || place.step === segment.step) return false;
      const start = place.step < 0;
      segment = {
        step: place.step,
        at: start ? audioStart : Math.max(audioStart, place.byte - SYNC_BACK),
        seekByte: start ? null : place.byte,
        ms: place.ms,
      };
      marks = [segment.at];
      counted = 0;
      countedTo = segment.at;
      return true;
    },
    range(fromMs, spanMs) {
      if (segment.seekByte !== null) {
        const ahead =
          SYNC_BACK + Math.ceil(((fromMs - segment.ms + spanMs) / frameMs) * average * 1.2) + 4096;
        return { start: segment.at, end: segment.at + Math.min(ahead, 4 * 1024 * 1024) };
      }
      const want = Math.max(0, Math.floor((fromMs - segment.ms) / frameMs) - 2 * MP3_WARM_UP);
      const frames = Math.ceil(spanMs / frameMs) + 2 * MP3_WARM_UP;
      if (want + frames > counted) {
        const ahead = Math.ceil((want + frames - counted) * average * 1.2) + 4096;
        // Counting from far behind reads the frames in between first; decoding keeps the end.
        return { start: countedTo, end: countedTo + Math.min(ahead, 4 * 1024 * 1024) };
      }
      const mark = Math.floor(want / 64);
      const start = marks[mark] ?? segment.at;
      return {
        start,
        end: start + Math.ceil((want - mark * 64 + frames) * average * 1.5) + 4096,
      };
    },
    run(bytes, start) {
      if (segment.seekByte !== null) {
        if (start !== segment.at) return null;
        const at = holding(bytes, start, segment.seekByte);
        if (at === null) return null;
        segment = { ...segment, at: start + at, seekByte: null };
        marks = [segment.at];
        counted = 0;
        countedTo = segment.at;
        const run = track.run(bytes.subarray(at), start + at);
        // Packets are placed in the bytes the caller holds.
        return run && { ...run, packets: run.packets.map((p) => ({ ...p, at: p.at + at })) };
      }
      // A run starts where counting stopped or at a kept 64th frame.
      const counting = start === countedTo;
      let index = counting ? counted : marks.indexOf(start) * 64;
      if (index < 0) return null;
      const places: number[] = [];
      let at = 0;
      for (;;) {
        const info = mp3FrameAt(bytes, at);
        if (!info || at + info.bytes > bytes.length) break;
        if (index % 64 === 0) marks[index / 64] = start + at;
        places.push(at);
        at += info.bytes;
        index++;
        if (start + at > countedTo) {
          countedTo = start + at;
          counted = index;
        }
      }
      if (places.length <= 2 * MP3_WARM_UP) return null;
      // A long count decodes only its last 15 s; the next look decodes what it needs.
      const keep = Math.ceil(15_000 / frameMs) + MP3_WARM_UP;
      const from = counting ? Math.max(0, places.length - keep) : 0;
      const firstIndex = index - places.length + from;
      const first = places[from] ?? 0;
      return {
        packets: [{ at: first, size: at - first }],
        startMs: segment.ms + firstIndex * frameMs,
        // Only the file's own first frame needs no warming up.
        skipMs: firstIndex === 0 && segment.step < 0 ? 0 : MP3_WARM_UP * frameMs,
        dropMs: 0,
      };
    },
  };
  return track;
}

// ---------------------------------------------------------------------------------------------
// MP4 and M4B (AAC)

type Box = { type: string; at: number; size: number; body: number };

/** The boxes in `bytes` from `from` to `to`. */
function boxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32(bytes, at);
    let body = at + 8;
    if (size === 1) {
      size = u32(bytes, at + 8) * 2 ** 32 + u32(bytes, at + 12);
      body = at + 16;
    } else if (size === 0) size = to - at;
    if (size < body - at) break;
    out.push({ type: ascii(bytes, at + 4, 4), at, size, body });
    at += size;
  }
  return out;
}

const child = (bytes: Uint8Array, box: Box | undefined, type: string): Box | undefined =>
  box
    ? boxes(bytes, box.body, Math.min(bytes.length, box.at + box.size)).find((b) => b.type === type)
    : undefined;

/**
 * Where the `moov` box is: in the first bytes, or past them after a large `mdat` (size null:
 * the box's header there has to be read, and may name another box to step over).
 */
export function mp4Moov(
  head: Uint8Array,
  size: number | null,
): { at: number; size: number | null } | null {
  let at = 0;
  for (;;) {
    if (at + 16 > head.length) return size && at + 8 <= size ? { at, size: null } : null;
    let boxSize = u32(head, at);
    if (boxSize === 1) boxSize = u32(head, at + 8) * 2 ** 32 + u32(head, at + 12);
    else if (boxSize === 0) return null;
    if (ascii(head, at + 4, 4) === 'moov') return { at, size: boxSize };
    if (boxSize < 8) return null;
    at += boxSize;
  }
}

/** The size and type of the box whose header is `header`. */
export function mp4BoxHeader(header: Uint8Array): { type: string; size: number } | null {
  if (header.length < 16) return null;
  let size = u32(header, 0);
  if (size === 1) size = u32(header, 8) * 2 ** 32 + u32(header, 12);
  return size >= 8 ? { type: ascii(header, 4, 4), size } : null;
}

/** The sample tables of the first sound track in a `moov` box. */
export type Mp4Index = {
  decoder: TrackDecoder;
  timescale: number;
  /** The media time that plays at 0, from the edit list. */
  startTime: number;
  sizes: Uint32Array;
  offsets: Float64Array;
  /** Runs of samples of one duration: first sample, decode time at it, duration. */
  runs: { first: number; time: number; delta: number }[];
};

export function mp4Index(moov: Uint8Array): Mp4Index | null {
  const top = boxes(moov, 0, moov.length).find((b) => b.type === 'moov');
  if (!top) return null;
  for (const trak of boxes(moov, top.body, top.at + top.size).filter((b) => b.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia');
    const hdlr = child(moov, mdia, 'hdlr');
    if (!hdlr || ascii(moov, hdlr.body + 8, 4) !== 'soun') continue;
    const mdhd = child(moov, mdia, 'mdhd');
    const stbl = child(moov, child(moov, mdia, 'minf'), 'stbl');
    if (!mdhd || !stbl) continue;
    const timescale = u32(moov, mdhd.body + (byte(moov, mdhd.body) === 1 ? 20 : 12));
    const decoder = mp4Decoder(moov, child(moov, stbl, 'stsd'));
    const stts = child(moov, stbl, 'stts');
    const stsc = child(moov, stbl, 'stsc');
    const stsz = child(moov, stbl, 'stsz');
    const stco = child(moov, stbl, 'stco') ?? child(moov, stbl, 'co64');
    if (!decoder || !timescale || !stts || !stsc || !stsz || !stco) continue;
    // Counts are bounded by their box, so a damaged table can't loop for long.
    const fits = (box: Box, header: number, entry: number, n: number) =>
      Math.min(n, Math.max(0, Math.floor((box.at + box.size - box.body - header) / entry)));
    const fixed = u32(moov, stsz.body + 4);
    const count = fixed
      ? Math.min(u32(moov, stsz.body + 8), 50_000_000)
      : fits(stsz, 12, 4, u32(moov, stsz.body + 8));
    const sizes = new Uint32Array(count);
    for (let i = 0; i < count; i++) sizes[i] = fixed || u32(moov, stsz.body + 12 + 4 * i);
    const offsets = new Float64Array(count);
    const wide = stco.type === 'co64';
    const chunks = fits(stco, 8, wide ? 8 : 4, u32(moov, stco.body + 4));
    const chunkAt = (c: number) =>
      wide
        ? u32(moov, stco.body + 8 + 8 * c) * 2 ** 32 + u32(moov, stco.body + 12 + 8 * c)
        : u32(moov, stco.body + 8 + 4 * c);
    const entries = fits(stsc, 8, 12, u32(moov, stsc.body + 4));
    let sample = 0;
    for (let e = 0; e < entries && sample < count; e++) {
      const firstChunk = u32(moov, stsc.body + 8 + 12 * e) - 1;
      const perChunk = u32(moov, stsc.body + 12 + 12 * e);
      if (perChunk === 0) break;
      const nextChunk = Math.min(
        chunks,
        e + 1 < entries ? u32(moov, stsc.body + 8 + 12 * (e + 1)) - 1 : chunks,
      );
      for (let c = firstChunk; c < nextChunk && sample < count; c++) {
        let at = chunkAt(c);
        for (let s = 0; s < perChunk && sample < count; s++) {
          offsets[sample] = at;
          at += sizes[sample] ?? 0;
          sample++;
        }
      }
    }
    const runs: Mp4Index['runs'] = [];
    let first = 0;
    let time = 0;
    for (let e = 0, n = fits(stts, 8, 8, u32(moov, stts.body + 4)); e < n; e++) {
      const samples = u32(moov, stts.body + 8 + 8 * e);
      const delta = u32(moov, stts.body + 12 + 8 * e);
      runs.push({ first, time, delta });
      first += samples;
      time += samples * delta;
    }
    return { decoder, timescale, startTime: editStart(moov, trak), sizes, offsets, runs };
  }
  return null;
}

/** The media time the edit list starts playing at; 0 without one. */
function editStart(moov: Uint8Array, trak: Box): number {
  const elst = child(moov, child(moov, trak, 'edts'), 'elst');
  if (!elst) return 0;
  const v1 = byte(moov, elst.body) === 1;
  const n = u32(moov, elst.body + 4);
  for (let e = 0; e < n; e++) {
    const at = elst.body + 8 + e * (v1 ? 20 : 12);
    const media = v1 ? u32(moov, at + 8) * 2 ** 32 + u32(moov, at + 12) : u32(moov, at + 4);
    // -1 marks an empty edit; it reads as all ones here.
    if (v1 ? media < 2 ** 63 : media !== 0xffffffff) return media;
  }
  return 0;
}

const AAC_RATES = [
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8000,
  7350,
];

/** The decoder for an `mp4a` sample entry with AAC in its `esds`. */
function mp4Decoder(moov: Uint8Array, stsd: Box | undefined): TrackDecoder | null {
  if (!stsd) return null;
  const entry = boxes(moov, stsd.body + 8, stsd.at + stsd.size)[0];
  if (!entry || entry.type !== 'mp4a') return null;
  // QuickTime sound descriptions of version 1 and 2 are longer.
  const version = u16(moov, entry.body + 8);
  const channels = u16(moov, entry.body + 16);
  const rate = u16(moov, entry.body + 24);
  const after = entry.body + 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
  const esds = findBox(moov, after, entry.at + entry.size, 'esds');
  if (!esds) return null;
  const config = esdsConfig(moov, esds.body + 4, esds.at + esds.size);
  if (!config || config.length < 2) return null;
  let objectType = byte(config, 0) >> 3;
  if (objectType === 31) objectType = 32 + (((byte(config, 0) & 7) << 3) | (byte(config, 1) >> 5));
  // Rate and channels from the AudioSpecificConfig (AAC-LC's layout); a QuickTime description of
  // version 2 has placeholders where version 0 has them.
  const rateIndex = ((byte(config, 0) & 7) << 1) | (byte(config, 1) >> 7);
  const channelConfig = (byte(config, 1) >> 3) & 15;
  const configRate = objectType < 31 ? AAC_RATES[rateIndex] : undefined;
  return {
    codec: `mp4a.40.${objectType}`,
    sampleRate: configRate ?? rate,
    numberOfChannels:
      objectType < 31 && channelConfig > 0 && channelConfig < 7 ? channelConfig : channels,
    description: config,
  };
}

/** A box anywhere from `from` to `to`, such as an `esds` inside a QuickTime `wave`. */
function findBox(bytes: Uint8Array, from: number, to: number, type: string): Box | undefined {
  for (const box of boxes(bytes, from, Math.min(to, bytes.length))) {
    if (box.type === type) return box;
    if (box.type === 'wave') {
      const inner = findBox(bytes, box.body, box.at + box.size, type);
      if (inner) return inner;
    }
  }
  return undefined;
}

/** The AudioSpecificConfig in an `esds` box's descriptors. */
function esdsConfig(bytes: Uint8Array, from: number, to: number): Uint8Array | null {
  let at = from;
  const length = () => {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const b = byte(bytes, at++);
      n = (n << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return n;
  };
  while (at < to) {
    const tag = byte(bytes, at++);
    const size = length();
    if (tag === 3) {
      const flags = byte(bytes, at + 2);
      at += 3;
      if (flags & 0x80) at += 2;
      if (flags & 0x40) at += 1 + byte(bytes, at);
      if (flags & 0x20) at += 2;
    } else if (tag === 4) at += 13;
    else if (tag === 5) return bytes.slice(at, at + size);
    else at += size;
  }
  return null;
}

/** An MP4 track: every sample's place and time come from its tables. */
export function mp4Track(index: Mp4Index): WebTrack {
  const { sizes, offsets, runs, timescale, startTime } = index;
  const count = sizes.length;
  const timeOf = (i: number): number => {
    let r = runs.length - 1;
    while (r > 0 && (runs[r]?.first ?? 0) > i) r--;
    const run = runs[r] ?? { first: 0, time: 0, delta: 0 };
    return run.time + (i - run.first) * run.delta;
  };
  /** The first index whose value is at or above `target`. */
  const search = (value: (i: number) => number, target: number): number => {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (value(mid) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const toTime = (ms: number) => (ms / 1000) * timescale + startTime;
  return {
    kind: 'mp4',
    decoder: index.decoder,
    sampleRate: index.decoder.sampleRate,
    range(fromMs, spanMs) {
      // A few samples early: the decoder's first ones are left out.
      const first = Math.max(0, search(timeOf, toTime(fromMs - SETTLE_MS)) - 2);
      const last = Math.min(count - 1, search(timeOf, toTime(fromMs + spanMs)));
      const start = offsets[first] ?? 0;
      return { start, end: (offsets[last] ?? start) + (sizes[last] ?? 0) };
    },
    run(bytes, start) {
      const first = search((i) => offsets[i] ?? 0, start);
      const packets: TrackPacket[] = [];
      let i = first;
      for (; i < count; i++) {
        const at = (offsets[i] ?? 0) - start;
        if (at + (sizes[i] ?? 0) > bytes.length) break;
        packets.push({ at, size: sizes[i] ?? 0 });
      }
      if (packets.length === 0) return null;
      return {
        packets,
        endMs: ((timeOf(i) - startTime) / timescale) * 1000,
        skipMs: first === 0 ? 0 : SETTLE_MS,
        dropMs: 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Ogg (Opus, Vorbis)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

function oggCrc(bytes: Uint8Array, from: number, to: number): number {
  let crc = 0;
  for (let i = from; i < to; i++) {
    // The checksum's own four bytes count as zeros.
    const b = i >= from + 22 && i < from + 26 ? 0 : byte(bytes, i);
    crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ b) & 0xff] ?? 0)) >>> 0;
  }
  return crc;
}

export type OggPage = {
  at: number;
  size: number;
  /** The granule position after the last packet that ends on this page; -1 when none does. */
  granule: number;
  serial: number;
  continued: boolean;
  /** Packet pieces on the page: where each starts, its length, and whether the packet ends. */
  pieces: { at: number; size: number; ends: boolean }[];
};

/** The Ogg page at `at`, checked by its CRC, or null. */
export function oggPageAt(bytes: Uint8Array, at: number): OggPage | null {
  if (at + 27 > bytes.length || ascii(bytes, at, 4) !== 'OggS' || byte(bytes, at + 4) !== 0)
    return null;
  const segments = byte(bytes, at + 26);
  let size = 27 + segments;
  for (let i = 0; i < segments; i++) size += byte(bytes, at + 27 + i);
  if (at + size > bytes.length) return null;
  if (oggCrc(bytes, at, at + size) !== u32le(bytes, at + 22)) return null;
  const low = u32le(bytes, at + 6);
  const high = u32le(bytes, at + 10);
  const granule = high === 0xffffffff && low === 0xffffffff ? -1 : high * 2 ** 32 + low;
  const pieces: OggPage['pieces'] = [];
  let p = at + 27 + segments;
  let pieceAt = p;
  for (let i = 0; i < segments; i++) {
    const lace = byte(bytes, at + 27 + i);
    p += lace;
    if (lace < 255) {
      pieces.push({ at: pieceAt, size: p - pieceAt, ends: true });
      pieceAt = p;
    }
  }
  if (pieceAt < p) pieces.push({ at: pieceAt, size: p - pieceAt, ends: false });
  return {
    at,
    size,
    granule,
    serial: u32le(bytes, at + 14),
    continued: (byte(bytes, at + 5) & 1) === 1,
    pieces,
  };
}

/** Pages from `from` on; where a page doesn't check out, the next capture pattern is tried. */
export function oggPages(bytes: Uint8Array, from = 0): OggPage[] {
  const pages: OggPage[] = [];
  let at = from;
  while (at + 27 <= bytes.length) {
    const page = oggPageAt(bytes, at);
    if (page) {
      pages.push(page);
      at += page.size;
      continue;
    }
    const next = bytes.indexOf(0x4f, at + 1);
    if (next < 0) break;
    at = next;
  }
  return pages;
}

/** Whole packets on `pages`, in order; pieces of a packet begun before them are left out. */
function oggPackets(bytes: Uint8Array, pages: OggPage[]) {
  const packets: Uint8Array[] = [];
  /** After each page: the packets that ended so far. */
  const ended: number[] = [];
  let pending: Uint8Array[] | null = null;
  for (const page of pages) {
    for (const [i, piece] of page.pieces.entries()) {
      const part = bytes.subarray(piece.at, piece.at + piece.size);
      if (i === 0 && page.continued) pending?.push(part);
      else pending = [part];
      if (piece.ends) {
        if (pending) packets.push(concat(pending));
        pending = null;
      }
    }
    ended.push(packets.length);
  }
  return { packets, ended };
}

export type OggCodec = {
  serial: number;
  decoder: TrackDecoder;
  /** Granule positions per second. */
  rate: number;
  /** Opus's pre-skip: granule positions before the element's time 0. */
  preSkip: number;
  /** The byte after the header pages. */
  audioStart: number;
};

/** The codec of an Ogg file from its header pages: Opus (one or two channels) or Vorbis. */
export function oggCodec(head: Uint8Array): OggCodec | null {
  const all = oggPages(head);
  const serial = all[0]?.serial;
  const pages = all.filter((p) => p.serial === serial);
  for (let n = 1; n <= pages.length; n++) {
    const { packets } = oggPackets(head, pages.slice(0, n));
    const last = pages[n - 1] as OggPage;
    const id = packets[0];
    if (serial === undefined || !id) continue;
    const audioStart = last.at + last.size;
    if (ascii(id, 0, 8) === 'OpusHead' && packets.length >= 2) {
      // Mapping family 0 is mono or stereo; more channels need a mapping this doesn't pass on.
      if (byte(id, 18) !== 0) return null;
      return {
        serial,
        decoder: { codec: 'opus', sampleRate: 48_000, numberOfChannels: byte(id, 9) },
        rate: 48_000,
        preSkip: byte(id, 10) | (byte(id, 11) << 8),
        audioStart,
      };
    }
    if (ascii(id, 1, 6) === 'vorbis' && packets.length >= 3) {
      const [, comment, setup] = packets as [Uint8Array, Uint8Array, Uint8Array];
      const rate = u32le(id, 12);
      // The three headers in Xiph lacing, as WebCodecs takes them.
      const lace = (length: number) =>
        Uint8Array.from([...Array<number>(Math.floor(length / 255)).fill(255), length % 255]);
      return {
        serial,
        decoder: {
          codec: 'vorbis',
          sampleRate: rate,
          numberOfChannels: byte(id, 11),
          description: concat([
            Uint8Array.of(2),
            lace(id.length),
            lace(comment.length),
            id,
            comment,
            setup,
          ]),
        },
        rate,
        preSkip: 0,
        audioStart,
      };
    }
  }
  return null;
}

/**
 * An Ogg track: a page carries the granule position at the end of its last whole packet, so a run
 * ends on the last page that finishes one, at that page's time.
 */
export function oggTrack(codec: OggCodec, size: number | null, durationMs: number): WebTrack {
  const clock = new ByteClock(codec.audioStart, size, durationMs);
  const ms = (granule: number) => ((granule - codec.preSkip) / codec.rate) * 1000;
  return {
    kind: 'ogg',
    decoder: codec.decoder,
    sampleRate: codec.decoder.sampleRate,
    // An Ogg page holds at most 65,307 bytes.
    range: (fromMs, spanMs) => {
      const range = guessRange(clock, fromMs, spanMs, 1000, 65_307);
      // The header pages share the stream's serial; they aren't sound.
      return { start: Math.max(codec.audioStart, range.start), end: range.end };
    },
    run(bytes, start) {
      const pages = oggPages(bytes).filter(
        (p) => p.serial === codec.serial && start + p.at >= codec.audioStart,
      );
      const { packets, ended } = oggPackets(bytes, pages);
      let kept = 0;
      let endGranule = -1;
      let endByte = 0;
      for (const [i, page] of pages.entries()) {
        if (page.granule < 0 || (ended[i] ?? 0) === (i > 0 ? ended[i - 1] : 0)) continue;
        // The first and last known places teach the clock where these times sit in the file.
        if (endGranule < 0) clock.learn(ms(page.granule), start + page.at + page.size);
        kept = ended[i] ?? 0;
        endGranule = page.granule;
        endByte = start + page.at + page.size;
      }
      if (kept === 0 || endGranule < 0) return null;
      clock.learn(ms(endGranule), endByte);
      const used = packets.slice(0, kept);
      let at = 0;
      return {
        packets: used.map((p) => {
          const packet = { at, size: p.length };
          at += p.length;
          return packet;
        }),
        data: concat(used),
        endMs: ms(endGranule),
        skipMs: start <= codec.audioStart ? 0 : SETTLE_MS,
        dropMs: 0,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// FLAC

export type FlacInfo = {
  sampleRate: number;
  channels: number;
  minBlock: number;
  /** The largest frame in bytes; 0 when the encoder didn't say. */
  maxFrame: number;
  /** The byte where the first frame starts, after the metadata blocks; null past `head`. */
  audioStart: number | null;
  /** `fLaC` and STREAMINFO, as WebCodecs takes them. */
  description: Uint8Array;
};

/** STREAMINFO and where the frames start, from a `fLaC` at `at`. */
export function flacInfo(head: Uint8Array, at: number): FlacInfo | null {
  let p = at + 4;
  let info: FlacInfo | null = null;
  for (;;) {
    if (p + 4 > head.length) return info;
    const type = byte(head, p) & 0x7f;
    const last = (byte(head, p) & 0x80) !== 0;
    const length = (byte(head, p + 1) << 16) | u16(head, p + 2);
    if (type === 0 && p + 4 + 34 <= head.length) {
      const s = p + 4;
      const block = Uint8Array.from(head.subarray(p, s + 34));
      block[0] = 0x80; // the only block handed on, so marked the last
      info = {
        minBlock: u16(head, s),
        maxFrame: (byte(head, s + 7) << 16) | u16(head, s + 8),
        sampleRate:
          (byte(head, s + 10) << 12) | (byte(head, s + 11) << 4) | (byte(head, s + 12) >> 4),
        channels: ((byte(head, s + 12) >> 1) & 7) + 1,
        audioStart: null,
        description: concat([Uint8Array.of(0x66, 0x4c, 0x61, 0x43), block]),
      };
    }
    p += 4 + length;
    if (last) return info ? { ...info, audioStart: p } : null;
  }
}

function crc8(bytes: Uint8Array, from: number, to: number): number {
  let crc = 0;
  for (let i = from; i < to; i++) {
    crc ^= byte(bytes, i);
    for (let j = 0; j < 8; j++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

export type FlacFrame = { at: number; sample: number; block: number };

/** The FLAC frame header at `at`, checked by its CRC-8, or null. */
export function flacFrameAt(bytes: Uint8Array, at: number, minBlock: number): FlacFrame | null {
  if (at + 6 > bytes.length || byte(bytes, at) !== 0xff || (byte(bytes, at + 1) & 0xfe) !== 0xf8)
    return null;
  const variable = byte(bytes, at + 1) & 1;
  const blockCode = byte(bytes, at + 2) >> 4;
  const rateCode = byte(bytes, at + 2) & 15;
  const channels = byte(bytes, at + 3) >> 4;
  const depth = (byte(bytes, at + 3) >> 1) & 7;
  if (blockCode === 0 || rateCode === 15 || channels > 10 || depth === 3 || depth === 7)
    return null;
  if (byte(bytes, at + 3) & 1) return null;
  // The frame or sample number, coded like UTF-8.
  let p = at + 4;
  const lead = byte(bytes, p++);
  const extra =
    lead < 0x80
      ? 0
      : lead < 0xc0
        ? -1
        : lead < 0xe0
          ? 1
          : lead < 0xf0
            ? 2
            : lead < 0xf8
              ? 3
              : lead < 0xfc
                ? 4
                : lead < 0xfe
                  ? 5
                  : 6;
  if (extra < 0) return null;
  let number = extra === 0 ? lead : lead & (0x3f >> extra);
  for (let i = 0; i < extra; i++) {
    const b = byte(bytes, p++);
    if ((b & 0xc0) !== 0x80) return null;
    number = number * 64 + (b & 0x3f);
  }
  let block: number;
  if (blockCode === 1) block = 192;
  else if (blockCode <= 5) block = 576 << (blockCode - 2);
  else if (blockCode === 6) block = byte(bytes, p++) + 1;
  else if (blockCode === 7) {
    block = u16(bytes, p) + 1;
    p += 2;
  } else block = 256 << (blockCode - 8);
  if (rateCode === 12) p += 1;
  else if (rateCode === 13 || rateCode === 14) p += 2;
  if (p >= bytes.length || crc8(bytes, at, p) !== byte(bytes, p)) return null;
  return { at, sample: variable ? number : number * minBlock, block };
}

/** A FLAC track: each frame header carries its first sample. */
export function flacTrack(info: FlacInfo, size: number | null, durationMs: number): WebTrack {
  const clock = new ByteClock(info.audioStart ?? 0, size, durationMs);
  const ms = (sample: number) => (sample / info.sampleRate) * 1000;
  return {
    kind: 'flac',
    sampleRate: info.sampleRate,
    decoder: {
      codec: 'flac',
      sampleRate: info.sampleRate,
      numberOfChannels: info.channels,
      description: info.description,
    },
    range: (fromMs, spanMs) => {
      const range = guessRange(clock, fromMs, spanMs, 1000, info.maxFrame || 32_768);
      return { start: Math.max(info.audioStart ?? 0, range.start), end: range.end };
    },
    run(bytes, start) {
      // Frames whose sample numbers follow on; a header that doesn't is audio that looks like one.
      const found = new Map<number, FlacFrame[]>();
      for (let at = 0; at + 6 <= bytes.length; at++) {
        const frame = flacFrameAt(bytes, at, info.minBlock);
        if (frame) found.set(frame.sample, [...(found.get(frame.sample) ?? []), frame]);
      }
      const after = (frame: FlacFrame) =>
        found.get(frame.sample + frame.block)?.find((next) => next.at > frame.at);
      const frames: FlacFrame[] = [];
      let frame = [...found.values()]
        .flat()
        .sort((a, b) => a.at - b.at)
        .find((f) => after(f));
      while (frame) {
        frames.push(frame);
        frame = after(frame);
      }
      // The last frame may be cut short: each frame ends where the next one starts.
      const first = frames[0];
      const last = frames[frames.length - 1];
      if (!first || !last || frames.length < 2) return null;
      clock.learn(ms(first.sample), start + first.at);
      clock.learn(ms(last.sample), start + last.at);
      return {
        packets: frames
          .slice(0, -1)
          .map((f, i) => ({ at: f.at, size: (frames[i + 1]?.at ?? 0) - f.at })),
        endMs: ms(last.sample),
        skipMs: 0,
        dropMs: 0,
      };
    },
  };
}
