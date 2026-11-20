import type { Manifest, Stream } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import type { FoundStream, InstalledAddon } from './client';
import {
  copyFallbackStep,
  copyKey,
  nextCopy,
  orderStreams,
  parseCodeList,
  type StreamPreferences,
} from './streamChoice';

const addon = (name: string): InstalledAddon => ({
  id: name,
  url: `https://${name.toLowerCase()}.example/manifest.json`,
  builtin: false,
  manifest: {
    id: `org.example.${name.toLowerCase()}`,
    version: '1.0.0',
    protocol: 1,
    name,
    description: '',
    types: ['audiobook'],
    resources: ['stream'],
    catalogs: [],
  } satisfies Manifest,
});
const librivox = addon('LibriVox');
const nas = addon('NAS');

const found = (
  from: InstalledAddon,
  sourceKey: string,
  extra: Partial<Stream> = {},
): FoundStream => ({
  addon: from,
  stream: { sourceKey, name: from.manifest.name, url: `https://a.example/${sourceKey}`, ...extra },
});

const prefs = (p: Partial<StreamPreferences> = {}): StreamPreferences => ({
  formats: [],
  languages: [],
  showPreparing: true,
  ...p,
});

const keys = (rows: ReturnType<typeof orderStreams>) =>
  rows.map((r) => r.copies.map((c) => c.stream.sourceKey).join('+'));

describe('orderStreams (M153)', () => {
  it('shows one release from two add-ons, MP3 and M4B, as one row, M4B first for who prefers it', () => {
    const rows = orderStreams(
      [
        found(librivox, 'mp3', { format: 'mp3', releaseId: 'urn:librivox:garden' }),
        found(nas, 'm4b', { format: 'm4b', releaseId: 'urn:librivox:garden' }),
      ],
      prefs({ formats: ['m4b'] }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.first.stream.sourceKey).toBe('m4b');
    expect(keys(rows)).toEqual(['m4b+mp3']);
  });

  it('puts a preferred language first, then a preferred format, then the add-ons’ order', () => {
    const rows = orderStreams(
      [
        found(librivox, 'de-mp3', { language: 'de', format: 'mp3' }),
        found(librivox, 'none'),
        found(librivox, 'en-mp3', { language: 'en', format: 'mp3' }),
        found(nas, 'en-m4b', { language: 'en-GB', format: 'm4b' }),
      ],
      prefs({ languages: ['en'], formats: ['m4b', 'mp3'] }),
    );
    expect(keys(rows)).toEqual(['en-m4b', 'en-mp3', 'de-mp3', 'none']);
  });

  it('keeps the add-ons’ order without preferences', () => {
    const list = [found(librivox, 'a'), found(nas, 'b'), found(librivox, 'c')];
    expect(keys(orderStreams(list, prefs()))).toEqual(['a', 'b', 'c']);
  });

  it('plays a ready copy before a preparing one, and hides preparing streams only when asked', () => {
    const list = [
      found(librivox, 'wait', { releaseId: 'urn:ia:raven', availability: 'preparing' }),
      found(nas, 'now', { releaseId: 'urn:ia:raven' }),
      found(nas, 'later', { availability: 'preparing' }),
    ];
    expect(keys(orderStreams(list, prefs()))).toEqual(['now+wait', 'later']);
    expect(keys(orderStreams(list, prefs({ showPreparing: false })))).toEqual(['now']);
  });

  it('merges one add-on’s copies of a release, once per account', () => {
    const list = [
      found(nas, 'home', { releaseId: 'urn:isbn:9780141389509' }),
      found(nas, 'work', { releaseId: 'urn:isbn:9780141389509' }),
    ];
    expect(keys(orderStreams(list, prefs()))).toEqual(['home+work']);
  });
});

describe('a row ranks as the copy that plays', () => {
  it('ranks a release by its ready MP3 while its M4B is still preparing', () => {
    const rows = orderStreams(
      [
        found(librivox, 'other-m4b', { format: 'm4b' }),
        found(nas, 'prep-m4b', { format: 'm4b', releaseId: 'urn:ia:x', availability: 'preparing' }),
        found(librivox, 'ready-mp3', { format: 'mp3', releaseId: 'urn:ia:x' }),
      ],
      prefs({ formats: ['m4b', 'mp3'] }),
    );
    expect(keys(rows)).toEqual(['other-m4b', 'ready-mp3+prep-m4b']);
  });
});

describe('parseCodeList', () => {
  it('reads formats and languages typed with commas or spaces', () => {
    expect(parseCodeList('M4B, mp3 m4b; ??', 'format')).toEqual(['m4b', 'mp3']);
    expect(parseCodeList('en, ms-MY, english', 'language')).toEqual(['en', 'ms-my']);
  });
});

describe('the next copy when one fails (M155)', () => {
  const ia = found(librivox, 'ia:garden:mp3', { releaseId: 'urn:ia:garden' });
  const home = found(nas, 'nas:garden', { releaseId: 'urn:ia:garden' });
  const deriving = found(nas, 'ia:garden:m4b', {
    releaseId: 'urn:ia:garden',
    availability: 'preparing',
  });

  it("takes the row's next copy in its order, skipping preparing ones", () => {
    const [row] = orderStreams([deriving, ia, home], prefs());
    const copies = row?.copies ?? [];
    expect(copies[0]).toBe(ia);
    expect(nextCopy(copies, [copyKey(ia)])).toBe(home);
    expect(nextCopy(copies, [copyKey(ia), copyKey(home)])).toBeNull();
  });

  it('moves on only while the copy has not played', () => {
    const fallback = { bookId: 'b1', tried: [copyKey(ia)], seen: false };
    const state = { bookId: 'b1', playing: false, error: null };
    const failed = { ...state, error: 'No answer from the server.' };
    expect(copyFallbackStep(fallback, { ...state, bookId: 'old' }).step).toBe('wait');
    // The last copy's error may still be on its way: only one after a clean report counts.
    expect(copyFallbackStep(fallback, failed).step).toBe('wait');
    const seen = copyFallbackStep(fallback, state);
    expect(seen).toEqual({ step: 'wait', fallback: { ...fallback, seen: true } });
    expect(copyFallbackStep(seen.fallback, failed).step).toBe('next');
    expect(copyFallbackStep(seen.fallback, { ...state, playing: true }).step).toBe('done');
    expect(copyFallbackStep(seen.fallback, { ...state, bookId: 'b2' }).step).toBe('done');
  });
});
