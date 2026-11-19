import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createDigest, integrityCheck, parseSri, type SriAlgorithm } from './integrity';

const ALGORITHMS: SriAlgorithm[] = ['sha256', 'sha384', 'sha512'];

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + (i >> 8)) & 0xff;
  return out;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sri = (algorithm: SriAlgorithm, data: Uint8Array) =>
  `${algorithm}-${createHash(algorithm).update(data).digest('base64')}`;

describe('createDigest', () => {
  it('matches Node for every length around the block edges', () => {
    for (const algorithm of ALGORITHMS) {
      for (const length of [0, 1, 55, 56, 63, 64, 65, 111, 112, 127, 128, 129, 1000]) {
        const data = bytes(length);
        const hash = createDigest(algorithm);
        hash.update(data);
        expect(hex(hash.digest()), `${algorithm} ${length}`).toBe(
          createHash(algorithm).update(data).digest('hex'),
        );
      }
    }
  });

  it('gives the same hash however the bytes are split', () => {
    const data = bytes(300_000);
    for (const algorithm of ALGORITHMS) {
      const hash = createDigest(algorithm);
      // Uneven parts, as a network stream hands them over.
      for (
        let at = 0, size = 1;
        at < data.length;
        at += size, size = ((size * 7 + 13) % 70_000) + 1
      ) {
        hash.update(data.subarray(at, at + size));
      }
      expect(hex(hash.digest())).toBe(createHash(algorithm).update(data).digest('hex'));
    }
  });

  it('knows the published value for "abc"', () => {
    const hash = createDigest('sha256');
    hash.update(new TextEncoder().encode('abc'));
    expect(hex(hash.digest())).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('parseSri', () => {
  it('takes the strongest algorithm and ignores options and unknown ones', () => {
    const value = `md5-AAAA ${sri('sha256', bytes(3))} ${sri('sha384', bytes(3))}?ct=audio/mpeg`;
    expect(parseSri(value)?.algorithm).toBe('sha384');
    expect(parseSri('md5-AAAA')).toBeNull();
    expect(parseSri('')).toBeNull();
  });
});

describe('integrityCheck', () => {
  it('matches the file it was made from and not another', () => {
    const data = bytes(5000);
    for (const algorithm of ALGORITHMS) {
      const good = integrityCheck(sri(algorithm, data));
      good?.update(data.subarray(0, 1234));
      good?.update(data.subarray(1234));
      expect(good?.matches()).toBe(true);
      const bad = integrityCheck(sri(algorithm, data));
      bad?.update(bytes(4999));
      expect(bad?.matches()).toBe(false);
    }
  });

  it('matches any of several digests of the same algorithm', () => {
    const data = bytes(10);
    const check = integrityCheck(`${sri('sha256', bytes(11))} ${sri('sha256', data)}`);
    check?.update(data);
    expect(check?.matches()).toBe(true);
  });

  it('leaves a value it cannot read unchecked', () => {
    expect(integrityCheck('sha1-abc')).toBeNull();
  });
});
