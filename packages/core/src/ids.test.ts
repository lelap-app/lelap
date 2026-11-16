import { describe, expect, it } from 'vitest';

import { createIdGenerator, uuidv7 } from './ids';

describe('uuidv7', () => {
  it('encodes the timestamp in the first 48 bits', () => {
    const id = uuidv7(0x0190_1234_5678, new Uint8Array(10));
    expect(id.startsWith('01901234-5678-7')).toBe(true);
  });

  it('sets version 7 and variant 10', () => {
    const id = uuidv7(1, new Uint8Array(10).fill(0xff));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('sorts by time', () => {
    let t = 0;
    const next = createIdGenerator(
      (n) => new Uint8Array(n).fill(0xff),
      () => ++t,
    );
    const a = next();
    const b = next();
    expect(a < b).toBe(true);
  });
});
