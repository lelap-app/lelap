import { describe, expect, it } from 'vitest';

import { levelTargetDb, Loudness, readTags, replayGainDb } from './webLoudness';
import {
  fastStretch,
  findMp3Frame,
  id3v2Size,
  mp3ByteAt,
  mp3FrameAt,
  mp3Layout,
  mp3MsAt,
  PauseMap,
  quietWindows,
  savedByFast,
  WEB_SILENCE_RULES,
} from './webSilence';

const encoder = new TextEncoder();

describe('quietWindows', () => {
  it('marks 10 ms windows whose peak stays under -30 dBFS', () => {
    const rate = 1000;
    const samples = new Float32Array(50);
    samples[15] = 0.5; // window 1 has sound
    samples[42] = 0.02; // under the threshold
    expect(quietWindows([samples], rate)).toEqual([true, false, true, true, true]);
  });

  it('keeps windows on exact times when 10 ms is no whole number of samples', () => {
    const samples = new Float32Array(22_050);
    samples[22_050 - 100] = 0.5; // 995.5 ms in: window 99
    const quiet = quietWindows([samples], 22_050);
    expect(quiet).toHaveLength(100);
    expect(quiet.indexOf(false)).toBe(99);
  });

  it('listens to the loudest channel', () => {
    const left = new Float32Array(20);
    const right = new Float32Array(20);
    right[3] = -0.9;
    expect(quietWindows([left, right], 1000)).toEqual([false, true]);
  });
});

describe('PauseMap', () => {
  const pattern = (map: PauseMap, startMs: number, text: string) =>
    map.mark(
      startMs,
      [...text].map((c) => c === '.'),
    );

  it('finds a long pause once both its ends are decoded', () => {
    const map = new PauseMap(10_000);
    // 100 ms of sound, 500 ms quiet, then 100 ms of sound.
    pattern(map, 0, 'x'.repeat(10) + '.'.repeat(50) + 'x'.repeat(10));
    expect(map.nextPause(0, 5_000)).toEqual({ startMs: 100, endMs: 600 });
    // From inside the pause, it is still the one.
    expect(map.nextPause(300, 5_000)).toEqual({ startMs: 100, endMs: 600 });
    expect(map.nextPause(600, 5_000)).toBeNull();
  });

  it('leaves out short pauses and those that run into undecoded audio', () => {
    const map = new PauseMap(10_000);
    pattern(map, 0, 'x'.repeat(5) + '.'.repeat(30) + 'x'.repeat(5) + '.'.repeat(60));
    expect(map.nextPause(0, 5_000)).toBeNull();
    pattern(map, 1_000, 'x');
    expect(map.nextPause(0, 5_000)).toEqual({ startMs: 400, endMs: 1_000 });
    expect(map.knownUntil(0)).toBe(1_010);
    expect(map.known(0, 1_000)).toBe(true);
    expect(map.known(0, 1_100)).toBe(false);
  });

  it('looks only as far as asked', () => {
    const map = new PauseMap(10_000);
    pattern(map, 0, 'x'.repeat(100) + '.'.repeat(50) + 'x');
    expect(map.nextPause(0, 500)).toBeNull();
    expect(map.nextPause(0, 1_100)).toEqual({ startMs: 1_000, endMs: 1_500 });
  });
});

const stretchOf = (pause: { startMs: number; endMs: number }) => {
  const s = fastStretch(pause);
  if (!s) throw new Error('no stretch');
  return s;
};

describe('fastStretch', () => {
  // What a pause lasts when its stretch plays `rate` times faster.
  const heard = (startMs: number, endMs: number) => {
    const s = stretchOf({ startMs, endMs });
    return endMs - startMs - (s.toMs - s.fromMs) * (1 - 1 / WEB_SILENCE_RULES.rate);
  };

  it('halves a pause of a second and keeps 150 ms at each end', () => {
    const s = stretchOf({ startMs: 0, endMs: 1_000 });
    expect(s.fromMs).toBeGreaterThanOrEqual(150);
    expect(1_000 - s.toMs).toBeGreaterThanOrEqual(150);
    expect(heard(0, 1_000)).toBeCloseTo(500, 0);
  });

  it('keeps about 0.75 s of a long pause, as far as the rate allows', () => {
    expect(heard(0, 2_000)).toBeCloseTo(750, 0);
    // Four times faster can't bring 6 s down to 0.75 s; the edges stay at 150 ms.
    const s = stretchOf({ startMs: 0, endMs: 6_000 });
    expect(s).toEqual({ fromMs: 150, toMs: 5_850 });
  });

  it('leaves pauses under 0.4 s alone', () => {
    expect(fastStretch({ startMs: 0, endMs: 390 })).toBeNull();
  });

  it('counts the time saved at the listening speed', () => {
    expect(savedByFast(400, 4, 1)).toBe(300);
    expect(savedByFast(400, 4, 2)).toBe(150);
    expect(savedByFast(0, 4, 1)).toBe(0);
  });
});

/** A frame of MPEG 2 layer III, 64 kbit/s, 22.05 kHz, as LibriVox's 64 kbit/s files are. */
function frame(padding = 0, info = false): number[] {
  const length = Math.floor(72 * (64_000 / 22_050)) + padding;
  const bytes = new Array<number>(length).fill(0);
  bytes[0] = 0xff;
  bytes[1] = 0xf3;
  bytes[2] = 0x80 | (padding << 1);
  bytes[3] = 0x64;
  if (info) [...'Info'].forEach((c, i) => (bytes[4 + 17 + i] = c.charCodeAt(0)));
  return bytes;
}

function id3(frames: [string, string][]): number[] {
  const body: number[] = [];
  for (const [name, value] of frames) {
    const text = [3, ...encoder.encode(name), 0, ...encoder.encode(value)];
    const n = text.length;
    body.push(...encoder.encode('TXXX'), n >> 21, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f);
    body.push(0, 0, ...text);
  }
  const n = body.length;
  return [0x49, 0x44, 0x33, 4, 0, 0, n >> 21, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f, ...body];
}

describe('MP3 layout', () => {
  it('reads a frame header', () => {
    expect(mp3FrameAt(Uint8Array.from(frame(1)), 0)).toEqual({
      bitrate: 64_000,
      sampleRate: 22_050,
      samplesPerFrame: 576,
      bytes: 209,
    });
    expect(mp3FrameAt(Uint8Array.from([0xff, 0xfb, 0xf0, 0]), 0)).toBeNull();
  });

  it('finds the audio after the tag and the Info frame, and maps bytes to time', () => {
    const tag = id3([['REPLAYGAIN_ALBUM_GAIN', '-3.5 dB']]);
    const bytes = Uint8Array.from([...tag, ...frame(0, true), ...frame(), ...frame(1), ...frame()]);
    const start = id3v2Size(bytes);
    expect(start).toBe(tag.length);
    const layout = mp3Layout(bytes, start);
    if (!layout) throw new Error('no layout');
    expect(layout.audioStart).toBe(tag.length + 208);
    expect(layout.bytesPerSecond).toBe(8_000);
    expect(mp3MsAt(layout, mp3ByteAt(layout, 1_500))).toBeCloseTo(1_500, 0);
  });

  it('skips a false sync inside the data', () => {
    const bytes = Uint8Array.from([
      0xff,
      0xf3,
      0x80,
      0x64,
      7,
      7,
      ...frame(),
      ...frame(),
      ...frame(),
    ]);
    expect(findMp3Frame(bytes, 0)).toBe(6);
  });

  it('gives up on a variable bitrate', () => {
    const xing = frame();
    [...'Xing'].forEach((c, i) => (xing[4 + 17 + i] = c.charCodeAt(0)));
    expect(mp3Layout(Uint8Array.from([...xing, ...frame(), ...frame()]), 0)).toBeNull();
  });
});

describe('ReplayGain', () => {
  it('prefers the album gain, then the track gain, then Opus R128 gains', () => {
    expect(
      replayGainDb([
        ['replaygain_track_gain', '-6.10 dB'],
        ['REPLAYGAIN_ALBUM_GAIN', '-4.20 dB'],
      ]),
    ).toBe(-4.2);
    expect(replayGainDb([['REPLAYGAIN_TRACK_GAIN', '+2.5']])).toBe(2.5);
    expect(replayGainDb([['R128_TRACK_GAIN', '-512']])).toBe(3);
    expect(replayGainDb([['REPLAYGAIN_TRACK_GAIN', 'loud']])).toBeNull();
    expect(replayGainDb([['REPLAYGAIN_TRACK_GAIN', '-40 dB']])).toBeNull();
  });

  it('reads TXXX frames from an ID3v2.4 tag', () => {
    const tags = readTags(Uint8Array.from([...id3([['REPLAYGAIN_ALBUM_GAIN', '-3.5 dB']]), 0xff]));
    expect(tags).toEqual([['REPLAYGAIN_ALBUM_GAIN', '-3.5 dB']]);
  });

  const comments = (lines: string[]) => {
    const out: number[] = [];
    const u32 = (n: number) => out.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24);
    u32(4);
    out.push(...encoder.encode('lelp'));
    u32(lines.length);
    for (const line of lines) {
      const b = encoder.encode(line);
      u32(b.length);
      out.push(...b);
    }
    return out;
  };

  it('reads Vorbis comments from FLAC', () => {
    const block = comments(['TITLE=Part 1', 'REPLAYGAIN_TRACK_GAIN=-1.00 dB']);
    const streamInfo = [0x00, 0, 0, 34, ...new Array<number>(34).fill(0)];
    const n = block.length;
    const bytes = Uint8Array.from([
      ...encoder.encode('fLaC'),
      ...streamInfo,
      0x84,
      (n >> 16) & 0xff,
      (n >> 8) & 0xff,
      n & 0xff,
      ...block,
    ]);
    expect(replayGainDb(readTags(bytes))).toBe(-1);
  });

  it('reads OpusTags from the second Ogg packet', () => {
    const page = (packet: number[]) => [
      ...encoder.encode('OggS'),
      ...new Array<number>(22).fill(0),
      1,
      packet.length,
      ...packet,
    ];
    const head = [...encoder.encode('OpusHead'), 1, 1, 0, 0];
    const tags = [...encoder.encode('OpusTags'), ...comments(['R128_TRACK_GAIN=256'])];
    expect(replayGainDb(readTags(Uint8Array.from([...page(head), ...page(tags)])))).toBe(6);
  });

  it('reads a freeform MP4 atom when moov comes first', () => {
    const box = (type: string, body: number[]) => {
      const n = body.length + 8;
      return [
        n >>> 24,
        (n >> 16) & 0xff,
        (n >> 8) & 0xff,
        n & 0xff,
        ...encoder.encode(type),
        ...body,
      ];
    };
    const freeform = box('----', [
      ...box('mean', [0, 0, 0, 0, ...encoder.encode('com.apple.iTunes')]),
      ...box('name', [0, 0, 0, 0, ...encoder.encode('replaygain_album_gain')]),
      ...box('data', [0, 0, 0, 1, 0, 0, 0, 0, ...encoder.encode('-2.00 dB')]),
    ]);
    const meta = box('meta', [0, 0, 0, 0, ...box('ilst', freeform)]);
    const bytes = Uint8Array.from([
      ...box('ftyp', [...encoder.encode('M4B '), 0, 0, 0, 0]),
      ...box('moov', box('udta', meta)),
    ]);
    expect(replayGainDb(readTags(bytes))).toBe(-2);
  });
});

describe('Loudness', () => {
  it('settles on the level of blocks with sound and leaves pauses out', () => {
    const level = new Loudness();
    expect(level.levelDb).toBeNull();
    level.add(0.001); // -30 dB
    level.add(1e-7); // a pause, under the gate
    level.add(0.001);
    expect(level.levelDb).toBeCloseTo(-30, 5);
    expect(levelTargetDb(null, level.levelDb)).toBeCloseTo(10, 5);
    level.forget();
    expect(level.levelDb).toBeNull();
  });

  it('takes the tag over the measurement, within ±10 dB', () => {
    expect(levelTargetDb(-4, -12)).toBe(-4);
    expect(levelTargetDb(null, -12)).toBe(-8);
    expect(levelTargetDb(null, -45)).toBe(10);
    expect(levelTargetDb(15, null)).toBe(10);
    expect(levelTargetDb(null, null)).toBe(0);
  });
});

describe('ID3 text encodings', () => {
  const frame = (encoding: number, text: number[]) => {
    const body = [encoding, ...text];
    const n = body.length;
    const tag = [...encoder.encode('TXXX'), 0, 0, (n >> 7) & 0x7f, n & 0x7f, 0, 0, ...body];
    const m = tag.length;
    return Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, (m >> 7) & 0x7f, m & 0x7f, ...tag]);
  };
  const utf16le = (s: string) => [0xff, 0xfe, ...[...s].flatMap((c) => [c.charCodeAt(0), 0])];
  const utf16be = (s: string) => [...s].flatMap((c) => [0, c.charCodeAt(0)]);

  it('reads UTF-16 with a byte order mark, UTF-16BE and UTF-8', () => {
    const name = 'REPLAYGAIN_ALBUM_GAIN';
    expect(readTags(frame(1, [...utf16le(name), 0, 0, ...utf16le('-2 dB')]))).toEqual([
      [name, '-2 dB'],
    ]);
    expect(readTags(frame(2, [...utf16be(name), 0, 0, ...utf16be('+1 dB')]))).toEqual([
      [name, '+1 dB'],
    ]);
    expect(readTags(frame(3, [...encoder.encode('Café'), 0, ...encoder.encode('ü')]))).toEqual([
      ['Café', 'ü'],
    ]);
  });
});
