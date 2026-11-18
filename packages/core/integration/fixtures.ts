// Tiny files made in the test: silent MP3s with made-up tags and a cover header. Never real books.

const utf8 = (text: string) => new TextEncoder().encode(text);

const synchsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];

function id3Frame(id: string, text: string): number[] {
  const body = [3, ...utf8(text)]; // 3: UTF-8
  return [...utf8(id), ...synchsafe(body.length), 0, 0, ...body];
}

/** An ID3v2.4 tag with a title, album and artist. */
function id3(tags: { title: string; album: string; artist: string }): number[] {
  const frames = [
    ...id3Frame('TIT2', tags.title),
    ...id3Frame('TALB', tags.album),
    ...id3Frame('TPE1', tags.artist),
  ];
  return [...utf8('ID3'), 4, 0, 0, ...synchsafe(frames.length), ...frames];
}

// MPEG-1 Layer III, 128 kbit/s, 44.1 kHz, mono: 417 bytes and 1152 samples a frame. All-zero
// side information means no audio data, which decoders play as silence.
const FRAME_BYTES = 417;
const FRAMES_PER_SECOND = 44_100 / 1152;

/** A silent MP3 of about [seconds], tagged. */
export function silentMp3(
  seconds: number,
  tags: { title: string; album: string; artist: string },
): Uint8Array {
  const head = id3(tags);
  const frames = Math.ceil(seconds * FRAMES_PER_SECOND);
  const out = new Uint8Array(head.length + frames * FRAME_BYTES);
  out.set(head);
  for (let i = 0; i < frames; i++) out.set([0xff, 0xfb, 0x90, 0xc0], head.length + i * FRAME_BYTES);
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type: string, data: Uint8Array): number[] {
  const typed = new Uint8Array([...utf8(type), ...data]);
  return [...u32(data.length), ...typed, ...u32(crc32(typed))];
}

/**
 * A PNG header of [width] × [height], padded past [bytes] with a private chunk, so a read of its
 * first 64 KB shows whether the server honoured the Range header. It has no pixels.
 */
export function coverPng(width: number, height: number, bytes: number): Uint8Array {
  const ihdr = new Uint8Array([...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
  return new Uint8Array([
    0x89,
    ...utf8('PNG\r\n\x1a\n'),
    ...chunk('IHDR', ihdr),
    ...chunk('lpAd', new Uint8Array(bytes)),
    ...chunk('IEND', new Uint8Array()),
  ]);
}

/** The folder both servers get: made-up books, names with spaces, accents and URL characters. */
export function testLibrary(): Map<string, Uint8Array> {
  const book = (artist: string, album: string, title: string) =>
    silentMp3(2, { title, album, artist });
  return new Map([
    [
      'Ada Quill/The Lantern Orchard/01 Arrival.mp3',
      book('Ada Quill', 'The Lantern Orchard', 'Arrival'),
    ],
    [
      'Ada Quill/The Lantern Orchard/02 Harvest.mp3',
      book('Ada Quill', 'The Lantern Orchard', 'Harvest'),
    ],
    // Two images with no usual name: the scan guesses by their sizes, read from the first 64 KB.
    ['Ada Quill/The Lantern Orchard/art.png', coverPng(600, 600, 70 * 1024)],
    ['Ada Quill/The Lantern Orchard/back.png', coverPng(1200, 400, 0)],
    [
      'Bram Østergaard/Søndag på øen/01 Første kapitel.mp3',
      book('Bram Østergaard', 'Søndag på øen', 'Første kapitel'),
    ],
    ['Loose & odd #1 (50%).mp3', book('Nobody', 'Loose & odd', 'Loose & odd #1 (50%)')],
  ]);
}
