import type { Manifest, Stream } from '@lelap/sdk';
import { describe, expect, it } from 'vitest';

import type { FoundStream, InstalledAddon } from './client';
import { orderStreams, parseCodeList, type StreamPreferences } from './streamChoice';

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
