import { describe, expect, it } from 'vitest';

import {
  HealthResponse,
  isConfigurable,
  Manifest,
  Meta,
  MetaPreview,
  needsConfiguration,
  offersHealth,
  protocolVersionOf,
  ScrobbleEvent,
  Stream,
  supports,
  wantsScrobble,
} from './protocol';

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

describe('MetaPreview badges', () => {
  const item = { id: 'lv:1', type: 'audiobook', name: 'A' } as const;

  it('keeps a rating and a count of new episodes', () => {
    const parsed = MetaPreview.parse({ ...item, badges: { rating: 4.5, newEpisodes: 3 } });
    expect(parsed.badges).toEqual({ rating: 4.5, newEpisodes: 3 });
  });

  it('accepts items without badges, as from older add-ons', () => {
    expect(MetaPreview.parse(item).badges).toBeUndefined();
  });

  it('drops badge fields it does not know, so later revisions can add some', () => {
    const parsed = MetaPreview.parse({ ...item, badges: { rating: 3, sparkles: true } });
    expect(parsed.badges).toEqual({ rating: 3 });
  });

  it('keeps the item but drops badges that do not fit', () => {
    for (const badges of [{ rating: 7 }, { rating: '4.5' }, { newEpisodes: -1 }, null]) {
      const parsed = MetaPreview.safeParse({ ...item, badges });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.badges).toBeUndefined();
    }
  });

  it('carries over to Meta', () => {
    expect(Meta.parse({ ...item, badges: { rating: 2 } }).badges).toEqual({ rating: 2 });
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

describe('protocol revision 2', () => {
  it('reads a v1 manifest as revision 1 with nothing new', () => {
    const parsed = Manifest.parse(base);
    expect(protocolVersionOf(parsed)).toBe(1);
    expect(isConfigurable(parsed)).toBe(false);
    expect(needsConfiguration(parsed)).toBe(false);
    expect(offersHealth(parsed)).toBe(false);
  });

  it('still reads the old top-level configurable', () => {
    expect(isConfigurable(Manifest.parse({ ...base, configurable: true }))).toBe(true);
  });

  it('reads behavior hints and drops unknown ones', () => {
    const parsed = Manifest.parse({
      ...base,
      protocolVersion: 2,
      behaviorHints: { configurationRequired: true, health: true, somethingLater: 1 },
    });
    expect(protocolVersionOf(parsed)).toBe(2);
    expect(isConfigurable(parsed)).toBe(true);
    expect(needsConfiguration(parsed)).toBe(true);
    expect(offersHealth(parsed)).toBe(true);
    expect(parsed.behaviorHints).not.toHaveProperty('somethingLater');
  });

  it('accepts a later revision but not another major protocol', () => {
    expect(Manifest.safeParse({ ...base, protocolVersion: 7 }).success).toBe(true);
    expect(Manifest.safeParse({ ...base, protocolVersion: 0 }).success).toBe(false);
    expect(Manifest.safeParse({ ...base, protocol: 2 }).success).toBe(false);
  });

  it('checks health answers', () => {
    expect(HealthResponse.safeParse({ status: 'ok' }).success).toBe(true);
    expect(HealthResponse.safeParse({ status: 'degraded', message: 'Slow' }).success).toBe(true);
    expect(HealthResponse.safeParse({ status: 'fine' }).success).toBe(false);
  });
});
