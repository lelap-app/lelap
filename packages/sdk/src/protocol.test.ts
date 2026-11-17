import { describe, expect, it } from 'vitest';

import { Manifest, Meta, ScrobbleEvent, Stream, supports, wantsScrobble } from './protocol';

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

describe('Meta series', () => {
  it('is optional and takes a position label', () => {
    const base = { id: 'ol:OL1W', type: 'audiobook', name: 'A' };
    expect(Meta.safeParse(base).success).toBe(true);
    expect(
      Meta.parse({ ...base, series: [{ name: 'Kingkiller Chronicle', position: '1' }] }).series,
    ).toEqual([{ name: 'Kingkiller Chronicle', position: '1' }]);
    expect(Meta.safeParse({ ...base, series: [{ name: '' }] }).success).toBe(false);
  });
});

describe('wantsScrobble', () => {
  it('follows the scrobble entry types and its own prefixes only', () => {
    const plain = { ...base, resources: ['scrobble' as const] };
    expect(wantsScrobble(plain, 'podcast')).toBe(true);
    expect(wantsScrobble(plain, 'episode')).toBe(false);
    expect(wantsScrobble(base, 'audiobook')).toBe(false);
    const narrow = {
      ...base,
      resources: [
        { name: 'scrobble' as const, types: ['audiobook' as const], idPrefixes: ['ol:'] },
      ],
    };
    expect(wantsScrobble(narrow, 'audiobook', 'ol:1')).toBe(true);
    expect(wantsScrobble(narrow, 'audiobook', 'lv:1')).toBe(false);
    expect(wantsScrobble(narrow, 'audiobook')).toBe(false);
  });
});

describe('ScrobbleEvent', () => {
  const event = {
    eventId: 'evt-00000001',
    event: 'rate',
    at: 1,
    item: { type: 'audiobook', name: 'One' },
    rating: 4.5,
  };
  it('takes half stars and rejects other ratings', () => {
    expect(ScrobbleEvent.safeParse(event).success).toBe(true);
    expect(ScrobbleEvent.safeParse({ ...event, rating: 4.2 }).success).toBe(false);
    expect(ScrobbleEvent.safeParse({ ...event, rating: 6 }).success).toBe(false);
  });
  it('keeps catalog shelves as free text', () => {
    expect(
      Manifest.safeParse({
        ...base,
        catalogs: [{ type: 'audiobook', id: 'w', name: 'W', shelf: 'something-new' }],
      }).success,
    ).toBe(true);
  });
});
