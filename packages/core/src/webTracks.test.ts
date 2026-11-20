import { describe, expect, it } from 'vitest';

import {
  ByteClock,
  flacFrameAt,
  flacInfo,
  flacTrack,
  mp4Index,
  mp4Moov,
  mp4Track,
  oggCodec,
  oggPageAt,
  oggTrack,
  trackHead,
  vbrMp3Track,
  xingSeek,
  firefoxXingSeek,
  mp3SeekRule,
} from './webTracks';

const encoder = new TextEncoder();

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing');
  return value;
}
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >> 8) & 255, n & 255];

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
  const all = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// MP4

const box = (type: string, ...body: (Uint8Array | number[])[]) => {
  const inner = concat(body);
  return concat([be32(inner.length + 8), encoder.encode(type), inner]);
};
const full = (type: string, ...body: (Uint8Array | number[])[]) => box(type, [0, 0, 0, 0], ...body);

/** A movie with one AAC track of `sizes.length` samples of 1024, in chunks of `perChunk`. */
function movie(sizes: number[], perChunk: number, chunkOffsets: number[], mediaStart = 2112) {
  const esds = full(
    'esds',
    [3, 25, 0, 1, 0],
    [4, 17, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [5, 2, 0x12, 0x08],
  );
  const mp4a = box(
    'mp4a',
    [0, 0, 0, 0, 0, 0, 0, 1],
    [0, 0, 0, 0, 0, 0, 0, 0],
    be16(1),
    be16(16),
    [0, 0, 0, 0],
    be16(44_100),
    [0, 0],
    esds,
  );
  const stbl = box(
    'stbl',
    full('stsd', be32(1), mp4a),
    full('stts', be32(1), be32(sizes.length), be32(1024)),
    full('stsc', be32(1), be32(1), be32(perChunk), be32(1)),
    full('stsz', be32(0), be32(sizes.length), ...sizes.map(be32)),
    full('stco', be32(chunkOffsets.length), ...chunkOffsets.map(be32)),
  );
  const mdia = box(
    'mdia',
    full('mdhd', be32(0), be32(0), be32(44_100), be32(sizes.length * 1024), [0, 0, 0, 0]),
    full('hdlr', be32(0), encoder.encode('soun'), new Uint8Array(12), [0]),
    box('minf', stbl),
  );
  const edts = box('edts', full('elst', be32(1), be32(1000), be32(mediaStart), be32(0x10000)));
  return box('moov', box('trak', edts, mdia));
}

describe('MP4 tracks', () => {
  const sizes = Array.from({ length: 100 }, (_, i) => 100 + (i % 7));
  // Chunks of 10 samples, with 50 bytes of another track between them.
  const offsets: number[] = [];
  let at = 1000;
  for (let c = 0; c < 10; c++) {
    offsets.push(at);
    for (let s = 0; s < 10; s++) at += sizes[c * 10 + s] ?? 0;
    at += 50;
  }
  const moov = movie(sizes, 10, offsets);

  it('reads the AAC config, every sample’s place and the edit list', () => {
    const index = mp4Index(moov);
    expect(index?.decoder).toMatchObject({
      codec: 'mp4a.40.2',
      sampleRate: 44_100,
      numberOfChannels: 1,
    });
    expect(Array.from(index?.decoder.description ?? [])).toEqual([0x12, 0x08]);
    expect(index?.startTime).toBe(2112);
    expect(index?.offsets[10]).toBe(offsets[1]);
    expect(index?.offsets[11]).toBe((offsets[1] ?? 0) + (sizes[10] ?? 0));
  });

  it('finds the samples in bytes read from anywhere, ending at their time', () => {
    const track = mp4Track(must(mp4Index(moov)));
    const fromMs = 1000;
    const range = track.range(fromMs, 500);
    const bytes = new Uint8Array(range.end - range.start);
    const run = must(track.run(bytes, range.start));
    const firstSample = Math.round(((fromMs - 100) / 1000) * 44.1 * (1000 / 1024) + 2112 / 1024);
    expect(run.packets.length).toBeGreaterThan(20);
    // Samples of another track in between are stepped over.
    expect(run.packets.every((p) => p.size >= 100 && p.size <= 106)).toBe(true);
    const lastIndex = firstSample - 3 + run.packets.length;
    expect(run.endMs).toBeCloseTo(((lastIndex * 1024 - 2112) / 44_100) * 1000, -2);
    expect(run.skipMs).toBeGreaterThan(0);
  });

  it('finds the moov after a large mdat that comes first', () => {
    const head = concat([
      box('ftyp', encoder.encode('M4A ')),
      be32(5_000_000),
      encoder.encode('mdat'),
    ]);
    expect(mp4Moov(concat([head, new Uint8Array(32)]), 6_000_000)).toEqual({
      at: 12 + 5_000_000,
      size: null,
    });
    expect(trackHead(concat([box('ftyp', encoder.encode('M4A ')), moov]), null)).toMatchObject({
      kind: 'mp4',
      moov: { at: 12 },
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Ogg

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

/** One Ogg page holding `packets`; the last continues on the next page when `open`. */
function page(granule: number, packets: Uint8Array[], flags = 0, open = false): Uint8Array {
  const lacing: number[] = [];
  packets.forEach((p, i) => {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    if (!(open && i === packets.length - 1)) lacing.push(n);
  });
  const g =
    granule < 0
      ? [255, 255, 255, 255, 255, 255, 255, 255]
      : [
          granule & 255,
          (granule >> 8) & 255,
          (granule >> 16) & 255,
          (granule >>> 24) & 255,
          0,
          0,
          0,
          0,
        ];
  const bytes = concat([
    encoder.encode('OggS'),
    [0, flags],
    g,
    [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [lacing.length],
    lacing,
    ...packets,
  ]);
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ (CRC[((crc >>> 24) ^ b) & 255] ?? 0)) >>> 0;
  bytes.set([crc & 255, (crc >> 8) & 255, (crc >> 16) & 255, crc >>> 24], 22);
  return bytes;
}

const opusHead = concat([
  encoder.encode('OpusHead'),
  [1, 1],
  [0x38, 0x01],
  [0x80, 0xbb, 0, 0],
  [0, 0],
  [0],
]);
const opusTags = concat([encoder.encode('OpusTags'), [0, 0, 0, 0, 0, 0, 0, 0]]);
const packet = (n: number, size = 60) => new Uint8Array(size).fill(n);

describe('Ogg tracks', () => {
  const head = concat([page(0, [opusHead], 2), page(0, [opusTags])]);

  it('reads Opus’s channels and pre-skip from the header pages', () => {
    const codec = oggCodec(head);
    expect(codec?.decoder).toEqual({ codec: 'opus', sampleRate: 48_000, numberOfChannels: 1 });
    expect(codec?.preSkip).toBe(312);
    expect(codec?.audioStart).toBe(head.length);
  });

  it('checks each page’s CRC', () => {
    const p = page(960, [packet(1)]);
    expect(oggPageAt(p, 0)?.granule).toBe(960);
    p[40] = (p[40] ?? 0) ^ 1;
    expect(oggPageAt(p, 0)).toBeNull();
  });

  it('ends a run at the granule of its last whole page, leaving out a packet begun before it', () => {
    const codec = must(oggCodec(head));
    // A packet that started on an earlier page, two whole ones, then one that runs on.
    const audio = concat([
      page(312 + 960 * 10, [packet(9, 30), packet(1), packet(2)], 1),
      page(-1, [packet(3, 255)], 0, true),
      page(312 + 960 * 13, [packet(3, 20), packet(4)], 1),
      page(312 + 960 * 14, [packet(5, 100)], 0, true),
    ]);
    const track = oggTrack(codec, null, 0);
    const run = must(track.run(audio, 50_000));
    // Packets 1, 2, 3 (255 + 20 bytes, over two pages) and 4; 5 doesn't end here.
    expect(run.packets.map((p) => p.size)).toEqual([60, 60, 275, 60]);
    expect(run.data?.[0]).toBe(1);
    expect(run.endMs).toBe(((960 * 13) / 48_000) * 1000);
  });

  it('leaves the header pages out of a run from the start of the file', () => {
    const codec = must(oggCodec(head));
    const file = concat([head, page(312 + 960 * 2, [packet(1), packet(2)])]);
    const track = oggTrack(codec, file.length, 40);
    expect(track.range(0, 10_000).start).toBe(head.length);
    const run = must(track.run(file, 0));
    expect(run.packets.map((p) => p.size)).toEqual([60, 60]);
    expect(run.data?.[0]).toBe(1);
  });

  it('builds the Vorbis description from the three headers', () => {
    const id = concat([
      [1],
      encoder.encode('vorbis'),
      [0, 0, 0, 0, 2],
      [0x44, 0xac, 0, 0],
      new Uint8Array(14),
    ]);
    const comment = concat([[3], encoder.encode('vorbis'), new Uint8Array(300)]);
    const setup = concat([[5], encoder.encode('vorbis'), new Uint8Array(40)]);
    const codec = oggCodec(concat([page(0, [id], 2), page(0, [comment, setup])]));
    expect(codec?.decoder.codec).toBe('vorbis');
    expect(codec?.decoder.numberOfChannels).toBe(2);
    expect(codec?.rate).toBe(44_100);
    // 2, then the first two lengths in Xiph lacing (30; 307 = 255 + 52), then the headers.
    expect(Array.from(codec?.decoder.description?.subarray(0, 4) ?? [])).toEqual([2, 30, 255, 52]);
  });
});

// ---------------------------------------------------------------------------------------------
// FLAC

function crc8(bytes: number[]): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = crc & 0x80 ? ((crc << 1) ^ 7) & 255 : (crc << 1) & 255;
  }
  return crc;
}

/** A fixed-blocksize (4096) frame header for frame `n`, and `size` bytes in all. */
function flacFrame(n: number, size: number): Uint8Array {
  const header = [0xff, 0xf8, 0xc9, 0x08, n];
  return concat([header, [crc8(header)], new Uint8Array(size - 6).fill(0x11)]);
}

const streamInfo = concat([
  encoder.encode('fLaC'),
  [0x80, 0, 0, 34],
  be16(4096),
  be16(4096),
  [0, 0, 0, 0, 0, 0],
  // 44100 Hz, 1 channel, 16 bits: 20 bits rate, 3 channels-1, 5 bits depth-1, 36 bits samples
  [0x0a, 0xc4, 0x40, 0xf0, 0, 0, 0, 0],
  new Uint8Array(16),
]);

describe('FLAC tracks', () => {
  it('reads STREAMINFO and where the frames start', () => {
    const info = flacInfo(streamInfo, 0);
    expect(info).toMatchObject({ sampleRate: 44_100, channels: 1, minBlock: 4096, audioStart: 42 });
    expect(info?.description.length).toBe(42);
    expect(trackHead(streamInfo, null)?.kind).toBe('flac');
  });

  it('places frames by their numbers and steps over a false sync', () => {
    const info = must(flacInfo(streamInfo, 0));
    expect(flacFrameAt(flacFrame(5, 50), 0, 4096)).toEqual({
      at: 0,
      sample: 5 * 4096,
      block: 4096,
    });
    // A false header for frame 99 inside the audio of frame 10.
    const fake = flacFrame(99, 20);
    const audio = concat([
      new Uint8Array(7),
      flacFrame(10, 300),
      fake,
      flacFrame(11, 300),
      flacFrame(12, 300),
      flacFrame(13, 40),
    ]);
    const run = must(flacTrack(info, null, 0).run(audio, 0));
    expect(run.packets.map((p) => p.size)).toEqual([320, 300, 300]);
    expect(run.endMs).toBeCloseTo(((13 * 4096) / 44_100) * 1000, 6);
  });
});

// ---------------------------------------------------------------------------------------------
// Variable-bitrate MP3

/** An MPEG 1 layer III frame at 44.1 kHz, mono, of the given bitrate index. */
function mp3Frame(bitrateIndex: number, fill = 0x55): Uint8Array {
  const kbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128][bitrateIndex] ?? 0;
  const size = Math.floor((144 * kbps * 1000) / 44_100);
  const out = new Uint8Array(size).fill(fill);
  out.set([0xff, 0xfb, bitrateIndex << 4, 0xc0]);
  return out;
}

function xingFrame(frames: number): Uint8Array {
  const frame = mp3Frame(9, 0);
  // Mono MPEG 1: the tag sits 4 + 17 bytes in. Frames flag only.
  frame.set([...encoder.encode('Xing'), 0, 0, 0, 1, ...be32(frames)], 21);
  return frame;
}

describe('variable-bitrate MP3s', () => {
  const frames = Array.from({ length: 300 }, (_, i) => mp3Frame(5 + (i % 4)));
  const file = concat([xingFrame(300), ...frames]);

  it('is told apart from a constant bitrate and starts after the Xing frame', () => {
    const head = trackHead(file, file.length);
    expect(head).toMatchObject({ kind: 'vbr-mp3', audioStart: xingFrame(1).length });
  });

  it('counts frames in order, then reads from a kept frame', () => {
    const head = trackHead(file, file.length);
    if (head?.kind !== 'vbr-mp3') throw new Error('not VBR');
    const track = vbrMp3Track(head, file.length);
    const frameMs = (1152 / 44_100) * 1000;
    // Asking for 5 s first counts frames from the start.
    let range = track.range(5000, 1000);
    expect(range.start).toBe(head.audioStart);
    let run = must(track.run(file.subarray(range.start, range.end), range.start));
    expect(track.counted()).toBeGreaterThan(5000 / frameMs);
    const startMs = must(run.startMs);
    expect(startMs).toBeCloseTo(Math.round(startMs / frameMs) * frameMs, 6);
    // Then 2 s, behind the count: from the 64th frame.
    range = track.range(2000, 1000);
    const at64 = head.audioStart + frames.slice(0, 64).reduce((s, f) => s + f.length, 0);
    expect(range.start).toBe(at64);
    run = must(track.run(file.subarray(range.start, range.end), range.start));
    expect(run.startMs).toBeCloseTo(64 * frameMs, 6);
    expect(run.skipMs).toBeCloseTo(2 * frameMs, 6);
  });
});

/** A Xing frame with frames, bytes and a table of contents, and a LAME tag with `delay` samples. */
function xingTocFrame(frames: number, bytes: number, toc: number[], delay: number): Uint8Array {
  const frame = mp3Frame(9, 0);
  frame.set([...encoder.encode('Xing'), 0, 0, 0, 7, ...be32(frames), ...be32(bytes), ...toc], 21);
  const lame = 21 + 8 + 8 + 100;
  frame.set(encoder.encode('LAME3.100'), lame);
  frame.set([(delay >> 4) & 255, (delay & 15) << 4], lame + 21);
  return frame;
}

describe('seeking in variable-bitrate MP3s (M134)', () => {
  const frames = Array.from({ length: 2000 }, (_, i) => mp3Frame(5 + (i % 4)));
  const audioBytes = frames.reduce((sum, f) => sum + f.length, 0);
  // A table that runs ahead of the bytes' real share, as LAME's often does.
  const toc = Array.from({ length: 100 }, (_, i) => Math.min(255, Math.round(i * 2.6)));
  const xing = xingTocFrame(2000, 417 + audioBytes, toc, 576);
  const file = concat([xing, ...frames]);
  const frameMs = (1152 / 44_100) * 1000;
  const durationMs = 2000 * frameMs;
  const head = (() => {
    const h = trackHead(file, file.length);
    if (h?.kind !== 'vbr-mp3') throw new Error('not VBR');
    return h;
  })();

  it('reads the table of contents and the delay', () => {
    expect(head.xing?.toc?.slice(0, 4)).toEqual([0, 3, 5, 8]);
    expect(head.frame.delayMs).toBeCloseTo(((576 + 529) / 44_100) * 1000, 6);
  });

  it('lands where Chrome does: the hundredth before the place, at its byte', () => {
    const place = must(xingSeek(head, file.length, 0.255 * durationMs));
    expect(place.step).toBe(25);
    expect(place.ms).toBeCloseTo(0.25 * durationMs, 6);
    expect(place.byte).toBe(417 + Math.round((65 * (417 + audioBytes)) / 256));
    // Before the encoder delay ends, the file's start, where the delay is left out.
    expect(xingSeek(head, file.length, 10)).toEqual({
      step: -1,
      byte: 417,
      ms: -head.frame.delayMs,
    });
    expect(must(xingSeek(head, file.length, 30)).step).toBe(0);
  });

  it('counts from the frame holding that byte, at the hundredth’s time', () => {
    const track = vbrMp3Track(head, file.length);
    const toMs = 0.405 * durationMs;
    expect(track.seeked?.(toMs)).toBe(true);
    // Another place in the same hundredth: the same timeline.
    expect(track.seeked?.(0.409 * durationMs)).toBe(false);
    const place = must(xingSeek(head, file.length, toMs));
    const range = track.range(toMs, 5000);
    expect(range.start).toBe(place.byte - 4096);
    const run = must(track.run(file.subarray(range.start, range.end), range.start));
    // The frame holding the byte starts at or before it, and plays at the hundredth's time.
    let at = 417;
    let holding = 0;
    for (const [i, f] of frames.entries()) {
      if (at + f.length > place.byte) {
        holding = i;
        break;
      }
      at += f.length;
    }
    expect(holding).toBeGreaterThan(0);
    expect(range.start + must(run.packets[0]).at).toBe(at);
    expect(must(run.startMs)).toBeCloseTo(place.ms, 6);
    expect(run.skipMs).toBeCloseTo(2 * frameMs, 6);
    // Later chunks count on from there.
    const next = track.range(toMs + 4000, 3000);
    expect(next.start).toBeGreaterThan(range.start);
    // Back to the start: the file's own timeline again.
    expect(track.seeked?.(0)).toBe(true);
    expect(track.range(0, 1000).start).toBe(417);
  });

  it('without a table of contents a seek changes nothing', () => {
    const plain = trackHead(concat([xingFrame(300), ...frames.slice(0, 300)]), null);
    if (plain?.kind !== 'vbr-mp3') throw new Error('not VBR');
    expect(vbrMp3Track(plain, null).seeked?.(5000)).toBe(false);
  });
});

describe('ByteClock', () => {
  it('guesses in a straight line and learns where times really are', () => {
    const clock = new ByteClock(100, 10_100, 100_000);
    expect(clock.byteAt(50_000)).toBe(5100);
    clock.learn(50_000, 7000);
    expect(clock.byteAt(50_000)).toBe(7000);
    expect(clock.byteAt(25_000)).toBe(3550);
    expect(clock.byteAt(75_000)).toBe(8550);
  });
});

describe('seeking in variable-bitrate MP3s in Firefox (M150)', () => {
  const frames = Array.from({ length: 2000 }, (_, i) => mp3Frame(5 + (i % 4)));
  const audioBytes = frames.reduce((sum, f) => sum + f.length, 0);
  const toc = Array.from({ length: 100 }, (_, i) => Math.min(255, Math.round(i * 2.6)));
  const xing = xingTocFrame(2000, 417 + audioBytes, toc, 576);
  const frameMs = (1152 / 44_100) * 1000;
  const durationMs = 2000 * frameMs;
  /** The file with an ID3 tag of `tag` bytes in front, as a podcast's cover makes. */
  const tagged = (tag: number) => {
    const size = tag - 10;
    const id3 = [
      0x49,
      0x44,
      0x33,
      3,
      0,
      0,
      (size >> 21) & 127,
      (size >> 14) & 127,
      (size >> 7) & 127,
      size & 127,
    ];
    const file = concat(tag > 0 ? [id3, new Uint8Array(size), xing, ...frames] : [xing, ...frames]);
    const head = trackHead(file, file.length);
    if (head?.kind !== 'vbr-mp3') throw new Error('not VBR');
    return { file, head };
  };
  /** Firefox's index for a table step: the step's byte from the file's start, over the Xing average. */
  const indexAt = (step: number, first: number) => {
    const offset = Math.trunc(
      Math.fround(Math.fround(1 / 256) * (toc[step] ?? 0)) * (417 + audioBytes),
    );
    return Math.trunc(Math.fround(Math.fround(offset - first) / (417 + audioBytes)) * 2000);
  };

  it('takes the hundredth’s byte from the file’s start and gives it the index’s time', () => {
    const { head } = tagged(0);
    const place = must(firefoxXingSeek(head, 0.405 * durationMs));
    const i = indexAt(40, 0);
    // The table runs ahead of the bytes, so the index is past the seek: from 1 % earlier, the
    // same hundredth here.
    expect(i * frameMs).toBeGreaterThan(0.405 * durationMs);
    expect(place.step).toBe(i);
    expect(place.byte).toBe(Math.trunc((i * (417 + audioBytes)) / 2000));
    expect(place.ms).toBeCloseTo((i - 1) * frameMs - head.frame.delayMs, 6);
    expect(firefoxXingSeek(head, 0)).toEqual({ step: -1, byte: 417, ms: -head.frame.delayMs });
  });

  it('seeks again from 1 % earlier when the first guess is past the place', () => {
    const { head } = tagged(0);
    // 10.0 %: step 10's index is past it; 1 % earlier is step 9.
    const toMs = 0.1 * durationMs + 1;
    expect(indexAt(10, 0) * frameMs).toBeGreaterThan(toMs);
    expect(must(firefoxXingSeek(head, toMs)).step).toBe(indexAt(9, 0));
  });

  it('counts an ID3 tag in, as Firefox does', () => {
    const { head } = tagged(20_000);
    const first = 20_000;
    const toMs = 0.605 * durationMs;
    const place = must(firefoxXingSeek(head, toMs));
    // The tag's bytes come off the index: it falls short of the place, so no second guess.
    expect(indexAt(60, first) * frameMs).toBeLessThan(toMs);
    expect(place.step).toBe(indexAt(60, first));
    expect(place.step).toBeLessThan(must(firefoxXingSeek(tagged(0).head, toMs)).step);
    expect(place.byte).toBe(first + Math.trunc((place.step * (417 + audioBytes)) / 2000));
  });

  it('counts from the first frame at or after that byte', () => {
    const { file, head } = tagged(0);
    const track = vbrMp3Track(head, file.length, 'firefox');
    const toMs = 0.405 * durationMs;
    expect(track.seeked?.(toMs)).toBe(true);
    const place = must(firefoxXingSeek(head, toMs));
    const range = track.range(toMs, 5000);
    const run = must(track.run(file.subarray(range.start, range.end), range.start));
    let at = 417;
    for (const f of frames) {
      if (at >= place.byte) break;
      at += f.length;
    }
    expect(range.start + must(run.packets[0]).at).toBe(at);
    expect(must(run.startMs)).toBeCloseTo(place.ms, 6);
  });
});

describe('mp3SeekRule (M150)', () => {
  it('names the rule each browser seeks by', () => {
    const chrome =
      'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0 Safari/537.36';
    expect(mp3SeekRule(chrome)).toBe('chrome');
    expect(mp3SeekRule(`${chrome} Edg/158.0`)).toBe('chrome');
    expect(
      mp3SeekRule('Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0'),
    ).toBe('firefox');
    expect(
      mp3SeekRule(
        'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
      ),
    ).toBeNull();
    expect(
      mp3SeekRule(
        'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/147.0 Mobile/15E148 Safari/605.1.15',
      ),
    ).toBeNull();
    expect(
      mp3SeekRule(
        'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/158.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBeNull();
  });
});
