import { describe, expect, it } from 'vitest';

import { type Manifest, Stream, supports } from './protocol';

const base: Manifest = {
  id: 'org.example.test',
  version: '1.0.0',
  protocol: 1,
  name: 'Test',
  description: '',
  types: ['audiobook', 'podcast'],
  resources: ['catalog', { name: 'stream', types: ['audiobook'], idPrefixes: ['lv:'] }, 'meta'],
  idPrefixes: ['lv:', 'ol:'],
  catalogs: [],
};

describe('supports', () => {
  it('uses the resource prefixes over the manifest ones', () => {
    expect(supports(base, 'stream', 'audiobook', 'lv:1')).toBe(true);
    expect(supports(base, 'stream', 'audiobook', 'ol:1')).toBe(false);
    expect(supports(base, 'meta', 'audiobook', 'ol:1')).toBe(true);
  });

  it('checks the types', () => {
    expect(supports(base, 'stream', 'podcast', 'lv:1')).toBe(false);
    expect(supports(base, 'meta', 'episode', 'lv:1')).toBe(false);
  });

  it('takes any ID when no prefixes are declared', () => {
    const open = { ...base, idPrefixes: undefined, resources: ['meta' as const] };
    expect(supports(open, 'meta', 'audiobook', 'anything:1')).toBe(true);
    expect(supports(open, 'stream', 'audiobook', 'anything:1')).toBe(false);
  });
});

describe('Stream', () => {
  it('accepts one file or parts, not neither', () => {
    expect(
      Stream.safeParse({ sourceKey: 'a', name: 'A', url: 'https://x.example/a.m4b' }).success,
    ).toBe(true);
    expect(
      Stream.safeParse({
        sourceKey: 'a',
        name: 'A',
        parts: [{ url: 'https://x.example/1.mp3', durationMs: 1000 }],
      }).success,
    ).toBe(true);
    expect(Stream.safeParse({ sourceKey: 'a', name: 'A' }).success).toBe(false);
  });

  it('rejects URLs that are not http', () => {
    expect(Stream.safeParse({ sourceKey: 'a', name: 'A', url: 'file:///etc/passwd' }).success).toBe(
      false,
    );
  });
});

describe('Stream with both url and parts', () => {
  it('reads it as parts', () => {
    const parsed = Stream.parse({
      sourceKey: 'a',
      name: 'A',
      url: 'https://x.example/a.m4b',
      parts: [{ url: 'https://x.example/1.mp3', durationMs: 1 }],
    });
    expect('parts' in parsed).toBe(true);
  });
});
