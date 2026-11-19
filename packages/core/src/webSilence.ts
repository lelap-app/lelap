/**
 * Skip silence for the web player (M101). The browser can't drop frames from a media element, so
 * the player decodes a little of the file ahead of the place, finds the pauses, and plays the
 * middle of each long one faster. The rules match the Android service's (`SilenceRules`): pauses
 * over 0.4 s are halved and keep at most 0.75 s.
 */
export const WEB_SILENCE_RULES = {
  /** A 10 ms window whose peak stays under this is quiet; Media3's default level, 1024 of 32768. */
  thresholdDb: -30,
  windowMs: 10,
  minPauseMs: 400,
  retention: 0.5,
  maxKeptMs: 750,
  /** Each end of a pause plays at the listening speed, so no word is sped up or cut. */
  edgeMs: 150,
  /** How much faster than the listening speed the middle plays. */
  rate: 4,
};

export type WebSilenceRules = typeof WEB_SILENCE_RULES;

export type Pause = { startMs: number; endMs: number };

/** The stretch of a pause played faster, in file milliseconds. */
export type FastStretch = { fromMs: number; toMs: number };

/** The byte at `at`, or 0 past the end. */
export const byte = (bytes: Uint8Array, at: number): number => bytes[at] ?? 0;

const UNKNOWN = 0;
const SOUND = 1;
const QUIET = 2;

/** Quiet (true) or not for each window of decoded samples, from the loudest channel. */
export function quietWindows(
  channels: Float32Array[],
  sampleRate: number,
  rules: Pick<WebSilenceRules, 'windowMs' | 'thresholdDb'> = WEB_SILENCE_RULES,
): boolean[] {
  // Windows start at exact times: 22.05 kHz has no whole number of samples in 10 ms.
  const perWindow = (sampleRate * rules.windowMs) / 1000;
  if (!(perWindow >= 1)) return [];
  const length = Math.min(...channels.map((c) => c.length));
  const threshold = 10 ** (rules.thresholdDb / 20);
  const out: boolean[] = [];
  for (let w = 0; Math.floor((w + 1) * perWindow) <= length; w++) {
    const start = Math.floor(w * perWindow);
    const end = Math.floor((w + 1) * perWindow);
    let peak = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        const x = Math.abs(channel[i] ?? 0);
        if (x > peak) peak = x;
      }
    }
    out.push(peak < threshold);
  }
  return out;
}

/**
 * What is known of one file: each window is quiet, sound, or not decoded yet. Pauses are found
 * only where both their ends are known.
 */
export class PauseMap {
  private windows: Uint8Array;

  constructor(
    durationMs: number,
    private readonly rules: WebSilenceRules = WEB_SILENCE_RULES,
  ) {
    this.windows = new Uint8Array(Math.ceil(Math.max(0, durationMs) / rules.windowMs) + 1);
  }

  get windowMs(): number {
    return this.rules.windowMs;
  }

  /** Records decoded windows that start at `startMs`. */
  mark(startMs: number, quiet: boolean[]): void {
    const first = Math.round(startMs / this.rules.windowMs);
    for (let i = 0; i < quiet.length; i++) {
      const at = first + i;
      if (at < 0) continue;
      if (at >= this.windows.length) this.grow(at + 1);
      this.windows[at] = quiet[i] ? QUIET : SOUND;
    }
  }

  /** Whether the windows from `fromMs` to `toMs` are all decoded. */
  known(fromMs: number, toMs: number): boolean {
    const end = Math.min(this.windows.length, Math.ceil(toMs / this.rules.windowMs));
    for (let i = Math.max(0, Math.floor(fromMs / this.rules.windowMs)); i < end; i++) {
      if (this.windows[i] === UNKNOWN) return false;
    }
    return true;
  }

  /** Where the decoded windows from `fromMs` on run out, in file milliseconds. */
  knownUntil(fromMs: number): number {
    let i = Math.max(0, Math.floor(fromMs / this.rules.windowMs));
    while (i < this.windows.length && this.windows[i] !== UNKNOWN) i++;
    return i * this.rules.windowMs;
  }

  /**
   * The first long pause that holds `atMs` or starts after it, within `lookMs`; null when there
   * is none or its end isn't decoded yet.
   */
  nextPause(atMs: number, lookMs: number): Pause | null {
    const w = this.rules.windowMs;
    const last = Math.min(this.windows.length, Math.ceil((atMs + lookMs) / w));
    let i = Math.max(0, Math.floor(atMs / w));
    // Back to the start of a pause the place is already in.
    while (i > 0 && this.windows[i] === QUIET && this.windows[i - 1] === QUIET) i--;
    while (i < last) {
      if (this.windows[i] !== QUIET) {
        i++;
        continue;
      }
      const start = i;
      while (i < this.windows.length && this.windows[i] === QUIET) i++;
      // A run that reaches undecoded audio may go on; it is looked at again once known.
      if (i < this.windows.length && this.windows[i] === UNKNOWN) return null;
      if (start > 0 && this.windows[start - 1] === UNKNOWN) continue;
      const pause = { startMs: start * w, endMs: i * w };
      if (pause.endMs - pause.startMs >= this.rules.minPauseMs && pause.endMs > atMs) return pause;
    }
    return null;
  }

  private grow(size: number): void {
    const next = new Uint8Array(size);
    next.set(this.windows);
    this.windows = next;
  }
}

/**
 * The middle of a pause to play `rules.rate` times faster, so that it lasts about what Android
 * keeps of it: half, at most 0.75 s. Both ends keep at least `edgeMs` at the listening speed.
 */
export function fastStretch(
  pause: Pause,
  rules: WebSilenceRules = WEB_SILENCE_RULES,
): FastStretch | null {
  const length = pause.endMs - pause.startMs;
  if (length < rules.minPauseMs) return null;
  const keep = Math.min(length * rules.retention, rules.maxKeptMs);
  // Edges e at the normal speed and the rest at the rate: 2e + (length - 2e) / rate = keep.
  const r = rules.rate;
  const edge = Math.max(rules.edgeMs, (keep - length / r) / (2 * (1 - 1 / r)));
  if (length - 2 * edge <= 0) return null;
  return { fromMs: pause.startMs + edge, toMs: pause.endMs - edge };
}

/** Listening time saved by playing `mediaMs` of a file `rate` times faster, at `speed`. */
export function savedByFast(mediaMs: number, rate: number, speed: number): number {
  if (mediaMs <= 0 || rate <= 1) return 0;
  return (mediaMs * (1 - 1 / rate)) / Math.max(0.1, speed);
}

/** One MPEG audio frame header. */
export type Mp3Frame = {
  bitrate: number;
  sampleRate: number;
  samplesPerFrame: number;
  bytes: number;
};

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = [44100, 48000, 32000];

/** An MPEG layer III frame header at `at`, or null. */
export function mp3FrameAt(bytes: Uint8Array, at: number): Mp3Frame | null {
  if (at < 0 || at + 4 > bytes.length) return null;
  const b1 = byte(bytes, at + 1);
  const b2 = byte(bytes, at + 2);
  if (bytes[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3; // 3: MPEG 1, 2: MPEG 2, 0: MPEG 2.5
  const layer = (b1 >> 1) & 3; // 1: layer III
  if (version === 1 || layer !== 1) return null;
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const v1 = version === 3;
  const bitrate = ((v1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex] ?? 0) * 1000;
  const sampleRate = (SAMPLE_RATES[rateIndex] ?? 0) / (v1 ? 1 : version === 2 ? 2 : 4);
  const samplesPerFrame = v1 ? 1152 : 576;
  const padding = (b2 >> 1) & 1;
  const bytesPerFrame = Math.floor((samplesPerFrame / 8) * (bitrate / sampleRate)) + padding;
  return { bitrate, sampleRate, samplesPerFrame, bytes: bytesPerFrame };
}

/** The first frame at or after `from` that the next two frames follow, so it isn't a false sync. */
export function findMp3Frame(bytes: Uint8Array, from: number): number | null {
  for (let at = Math.max(0, from); at + 4 <= bytes.length; at++) {
    const first = mp3FrameAt(bytes, at);
    if (!first) continue;
    const second = mp3FrameAt(bytes, at + first.bytes);
    if (!second || second.sampleRate !== first.sampleRate) continue;
    const third = mp3FrameAt(bytes, at + first.bytes + second.bytes);
    if (third && third.sampleRate === first.sampleRate) return at;
    // Near the end of what was read, two frames in a row will do.
    if (at + first.bytes + second.bytes + 4 > bytes.length) return at;
  }
  return null;
}

/** What the player needs to find any moment of a constant-bitrate MP3 by byte. */
export type Mp3Layout = {
  /** The byte where the first audio frame starts, after tags and a Xing or Info frame. */
  audioStart: number;
  bytesPerSecond: number;
  sampleRate: number;
  samplesPerFrame: number;
  /** Bytes of one frame, about. */
  frameBytes: number;
  /**
   * The encoder's delay that browsers trim from the start (from the LAME tag, plus the decoder's
   * 529 samples), so decoded frames line up with the element's time.
   */
  delayMs: number;
};

/** Size of an ID3v2 tag at the start, or 0. */
export function id3v2Size(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  return 10 + syncsafe(bytes, 6) + (byte(bytes, 5) & 0x10 ? 10 : 0);
}

/** A 28-bit number in four bytes of seven bits, as ID3v2 writes sizes. */
export function syncsafe(bytes: Uint8Array, at: number): number {
  return (
    ((byte(bytes, at) & 0x7f) << 21) |
    ((byte(bytes, at + 1) & 0x7f) << 14) |
    ((byte(bytes, at + 2) & 0x7f) << 7) |
    (byte(bytes, at + 3) & 0x7f)
  );
}

/**
 * The layout of an MP3 from its first bytes (after any ID3v2 tag, `start` bytes in), or null
 * for another format or a variable bitrate, where bytes don't map evenly onto time.
 */
export function mp3Layout(head: Uint8Array, start: number): Mp3Layout | null {
  const at = findMp3Frame(head, start);
  if (at === null || at - start > 4096) return null;
  const first = mp3FrameAt(head, at);
  if (!first) return null;
  const v1 = first.samplesPerFrame === 1152;
  const mono = byte(head, at + 3) >> 6 === 3;
  // The Xing or Info frame sits where the side information would be.
  const side = v1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const tag = String.fromCharCode(...head.subarray(at + 4 + side, at + 8 + side));
  if (tag === 'Xing' || tag === 'VBRI') return null;
  let audioStart = at;
  let delayMs = 0;
  if (tag === 'Info') {
    audioStart = at + first.bytes;
    const delay = lameDelay(head, at + 8 + side);
    if (delay !== null) delayMs = ((delay + DECODER_DELAY) / first.sampleRate) * 1000;
  }
  // Without a tag a constant bitrate shows in the frames that follow.
  let next = audioStart;
  for (let i = 0; i < 8; i++) {
    const frame = mp3FrameAt(head, next);
    if (!frame) break;
    if (frame.bitrate !== first.bitrate || frame.sampleRate !== first.sampleRate) return null;
    next += frame.bytes;
  }
  return {
    audioStart,
    bytesPerSecond: first.bitrate / 8,
    sampleRate: first.sampleRate,
    samplesPerFrame: first.samplesPerFrame,
    frameBytes: (first.samplesPerFrame / 8) * (first.bitrate / first.sampleRate),
    delayMs,
  };
}

const DECODER_DELAY = 529;

/** The encoder delay in samples from the LAME tag after an Info header's fields, or null. */
function lameDelay(head: Uint8Array, flagsAt: number): number | null {
  if (flagsAt + 4 > head.length) return null;
  const flags = byte(head, flagsAt + 3);
  let at = flagsAt + 4;
  if (flags & 1) at += 4;
  if (flags & 2) at += 4;
  if (flags & 4) at += 100;
  if (flags & 8) at += 4;
  if (at + 24 > head.length) return null;
  // Nine bytes name the encoder (`LAME3.100`, `Lavc58.13`); the delay sits 21 bytes in.
  if (!/^[A-Za-z]{3,4}/.test(String.fromCharCode(...head.subarray(at, at + 4)))) return null;
  return (byte(head, at + 21) << 4) | (byte(head, at + 22) >> 4);
}

/** The byte of a moment in a constant-bitrate MP3, about; a frame boundary is found from it. */
export const mp3ByteAt = (layout: Mp3Layout, ms: number): number =>
  Math.round(layout.audioStart + (Math.max(0, ms + layout.delayMs) / 1000) * layout.bytesPerSecond);

/** The element's time where decoding from a frame at `byte` starts, in milliseconds. */
export const mp3MsAt = (layout: Mp3Layout, byte: number): number =>
  ((byte - layout.audioStart) / layout.bytesPerSecond) * 1000 - layout.delayMs;
