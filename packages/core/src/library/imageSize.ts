import type { ImageSize } from './files';

/** Bytes from the start of a file that `imageSize` needs: enough for JPEGs with EXIF data. */
export const IMAGE_HEAD_BYTES = 64 * 1024;

const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32be = (b: Uint8Array, at: number) => u16be(b, at) * 0x10000 + u16be(b, at + 2);
const u24le = (b: Uint8Array, at: number) =>
  (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...b.subarray(at, at + length));

const sized = (width: number, height: number): ImageSize | null =>
  width > 0 && height > 0 ? { width, height } : null;

/**
 * A JPEG, PNG or WebP image's width and height from the start of the file (`IMAGE_HEAD_BYTES`),
 * without decoding it. Null for other formats, or when the size lies further in.
 */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length >= 24 && ascii(bytes, 1, 3) === 'PNG' && ascii(bytes, 12, 4) === 'IHDR') {
    return sized(u32be(bytes, 16), u32be(bytes, 20));
  }
  if (bytes.length >= 25 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return webp(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  return null;
}

function webp(b: Uint8Array): ImageSize | null {
  const chunk = ascii(b, 12, 4);
  // Lossy: a key frame's 14-bit width and height.
  if (chunk === 'VP8 ' && b.length >= 30) {
    return sized(
      ((b[26] ?? 0) | ((b[27] ?? 0) << 8)) & 0x3fff,
      ((b[28] ?? 0) | ((b[29] ?? 0) << 8)) & 0x3fff,
    );
  }
  // Lossless: 14 bits each, minus one, after the 0x2f signature.
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const b1 = b[21] ?? 0;
    const b2 = b[22] ?? 0;
    const b3 = b[23] ?? 0;
    const b4 = b[24] ?? 0;
    return sized(1 + (((b2 & 0x3f) << 8) | b1), 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)));
  }
  // Extended: the canvas, 24 bits each, minus one.
  if (chunk === 'VP8X' && b.length >= 30) return sized(1 + u24le(b, 24), 1 + u24le(b, 27));
  return null;
}

function jpeg(b: Uint8Array): ImageSize | null {
  let pos = 2;
  while (pos + 4 <= b.length) {
    if (b[pos] !== 0xff) return null;
    const marker = b[pos + 1] ?? 0;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      pos++;
      continue;
    }
    // Markers without a length: restarts, start of image, TEM.
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      pos += 2;
      continue;
    }
    const length = u16be(b, pos + 2);
    // Start of frame, any kind; C4, C8 and CC are tables, not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (pos + 9 > b.length) return null;
      return sized(u16be(b, pos + 7), u16be(b, pos + 5));
    }
    if (marker === 0xd9 || marker === 0xda || length < 2) return null;
    pos += 2 + length;
  }
  return null;
}
