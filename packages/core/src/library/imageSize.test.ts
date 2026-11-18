import { describe, expect, it } from 'vitest';

import { imageSize, looksLikeImage } from './imageSize';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [...u16(n >>> 16), ...u16(n & 0xffff)];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

describe('looksLikeImage', () => {
  const pad = new Array<number>(8).fill(0);
  it('knows the image formats covers come in', () => {
    expect(looksLikeImage(bytes([0xff, 0xd8, 0xff, 0xe0], pad))).toBe(true);
    expect(looksLikeImage(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], pad))).toBe(true);
    expect(looksLikeImage(bytes('GIF89a', pad))).toBe(true);
    expect(looksLikeImage(bytes('RIFF', u32(100), 'WEBP'))).toBe(true);
    expect(looksLikeImage(bytes(u32(24), 'ftypavif', pad))).toBe(true);
  });
  it('refuses a page or an error sent with a 200', () => {
    expect(looksLikeImage(bytes('<!doctype html><html>'))).toBe(false);
    expect(looksLikeImage(bytes('{"error":"no"}'))).toBe(false);
    expect(looksLikeImage(bytes([0xff, 0xd8]))).toBe(false);
  });
});

describe('imageSize', () => {
  it('reads a PNG header', () => {
    const png = bytes(
      [0x89],
      'PNG',
      [0x0d, 0x0a, 0x1a, 0x0a],
      u32(13),
      'IHDR',
      u32(1400),
      u32(1200),
    );
    expect(imageSize(png)).toEqual({ width: 1400, height: 1200 });
  });

  it('reads a JPEG frame after EXIF data, fill bytes and tables', () => {
    const exif = [0xff, 0xe1, ...u16(2 + 300), ...new Array<number>(300).fill(0x20)];
    const table = [0xff, 0xc4, ...u16(4), 0, 0];
    const progressive = [0xff, 0xff, 0xc2, ...u16(17), 8, ...u16(900), ...u16(1600), 3];
    expect(imageSize(bytes([0xff, 0xd8], exif, table, progressive))).toEqual({
      width: 1600,
      height: 900,
    });
  });

  it('gives up on a JPEG whose frame lies past the bytes it has', () => {
    const big = [0xff, 0xe1, ...u16(60_000), ...new Array<number>(100).fill(0)];
    expect(imageSize(bytes([0xff, 0xd8], big))).toBeNull();
    expect(imageSize(bytes([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0]))).toBeNull();
  });

  it('reads lossy, lossless and extended WebP', () => {
    const riff = (chunk: string, body: number[]) =>
      bytes('RIFF', u32(0), 'WEBP', chunk, u32(body.length), body);
    // Lossy: frame tag (3), start code (3), then 14-bit sizes.
    const lossy = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(800), ...le16(600)]);
    expect(imageSize(lossy)).toEqual({ width: 800, height: 600 });
    // Lossless: 0x2f, then width-1 and height-1 in 14 bits each.
    const w = 640 - 1;
    const h = 480 - 1;
    const bits = w | (h << 14);
    const lossless = riff('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >>> 24) & 0xff,
    ]);
    expect(imageSize(lossless)).toEqual({ width: 640, height: 480 });
    const extended = riff('VP8X', [0, 0, 0, 0, ...le24(2999), ...le24(1999)]);
    expect(imageSize(extended)).toEqual({ width: 3000, height: 2000 });
  });

  it('says nothing about other formats or too few bytes', () => {
    expect(imageSize(bytes('GIF89a', [10, 0, 10, 0]))).toBeNull();
    expect(imageSize(bytes([0x89], 'PNG'))).toBeNull();
    expect(imageSize(new Uint8Array())).toBeNull();
  });
});
