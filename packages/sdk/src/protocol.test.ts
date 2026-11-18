import { describe, expect, it } from 'vitest';

import {
  applySignin,
  HealthResponse,
  offersSignin,
  SigninResult,
  SigninStart,
  isConfigurable,
  LibraryResponse,
  offersLibrary,
  offersPlaces,
  PlaceReport,
  QueryParams,
  readSettings,
  RequestHeaders,
  settingHosts,
  type SettingField,
  StreamResponse,
  WebStreamResponse,
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

describe('revision 5: add-ons as library sources', () => {
  const inApp: Manifest = {
    ...base,
    resources: ['library'],
    sandbox: { hosts: [] },
    settings: [
      { key: 'url', label: 'Server address', type: 'url', required: true, host: true },
      { key: 'user', label: 'User', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
    ],
  };

  it('accepts settings and a library for an add-on inside the app', () => {
    const parsed = Manifest.parse(inApp);
    expect(parsed.settings).toHaveLength(3);
    expect(offersLibrary(parsed)).toBe(true);
  });

  it('refuses settings and a library without a sandbox', () => {
    const web = { ...inApp, sandbox: undefined };
    expect(Manifest.safeParse(web).success).toBe(false);
    expect(Manifest.safeParse({ ...web, settings: undefined }).success).toBe(false);
    expect(Manifest.safeParse({ ...web, resources: ['catalog'] }).success).toBe(false);
    expect(offersLibrary({ ...base, resources: ['library'] })).toBe(false);
  });

  it('refuses repeated keys and a host on a field that is not an address', () => {
    const twice = { ...inApp, settings: [inApp.settings?.[1], inApp.settings?.[1]] };
    expect(Manifest.safeParse(twice).success).toBe(false);
    const hostOnText = { ...inApp, settings: [{ key: 'a', label: 'A', type: 'text', host: true }] };
    expect(Manifest.safeParse(hostOnText).success).toBe(false);
  });

  it('checks what the listener typed', () => {
    const fields = inApp.settings as SettingField[];
    expect(readSettings(fields, { user: 'me' })).toEqual({ error: 'Server address is needed.' });
    expect(readSettings(fields, { url: 'ftp://nas' })).toHaveProperty('error');
    expect(readSettings(fields, { url: 'http://me:pw@nas' })).toHaveProperty('error');
    expect(
      readSettings(fields, { url: ' http://nas.local:8080/books ', password: ' pw ', other: 'x' }),
    ).toEqual({ settings: { url: 'http://nas.local:8080/books', user: '', password: ' pw ' } });
  });

  it('lets the add-on reach only the hosts of address fields marked host', () => {
    const fields: SettingField[] = [
      { key: 'url', label: 'A', type: 'url', host: true },
      { key: 'other', label: 'B', type: 'url' },
    ];
    expect(
      settingHosts(fields, { url: 'http://NAS.local:8080/x', other: 'https://elsewhere.example' }),
    ).toEqual(['nas.local:8080']);
    expect(settingHosts(fields, { url: 'https://nas.local/books' })).toEqual(['nas.local:443']);
    expect(settingHosts(fields, { url: 'not an address' })).toEqual([]);
  });

  it('takes request headers with sane names and values only', () => {
    expect(
      RequestHeaders.safeParse({ Authorization: 'Basic YTpi', 'X-Api-Key': 'k' }).success,
    ).toBe(true);
    for (const bad of [
      { Cookie: 'a=b' },
      { host: 'evil.example' },
      { Range: 'bytes=0-' },
      { 'Bad Name': 'x' },
      { Authorization: 'a\r\nX-Injected: 1' },
    ]) {
      expect(RequestHeaders.safeParse(bad).success).toBe(false);
    }
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`X-${i}`, 'v']));
    expect(RequestHeaders.safeParse(many).success).toBe(false);
  });

  it('keeps stream headers for add-ons inside the app and refuses them from web add-ons', () => {
    const body = {
      streams: [
        { sourceKey: 'k', name: 'N', url: 'http://nas/1.mp3', headers: { Authorization: 'x' } },
      ],
    };
    expect(StreamResponse.parse(body).streams[0]?.headers).toEqual({ Authorization: 'x' });
    expect(WebStreamResponse.safeParse(body).success).toBe(false);
    expect(
      WebStreamResponse.safeParse({ streams: [{ ...body.streams[0], headers: undefined }] })
        .success,
    ).toBe(true);
  });

  it('reads a library listing and refuses paths that climb out of it', () => {
    const file = { path: 'Author/Book/01.mp3', url: 'http://nas/Author/Book/01.mp3' };
    const parsed = LibraryResponse.parse({
      files: [{ ...file, size: 10, durationMs: 1000, ids: ['isbn:9780141036144'] }],
      headers: { Authorization: 'Basic YTpi' },
    });
    expect(parsed.files[0]?.durationMs).toBe(1000);
    for (const path of ['../etc/passwd', 'a//b.mp3', '/abs.mp3', 'a/./b.mp3']) {
      expect(LibraryResponse.safeParse({ files: [{ ...file, path }] }).success).toBe(false);
    }
  });
});

describe('revision 6: places and logins in the address', () => {
  const inApp: Manifest = {
    ...base,
    protocolVersion: 6,
    resources: ['library', 'place'],
    sandbox: { hosts: [] },
  };

  it('keeps places for add-ons inside the app only', () => {
    expect(offersPlaces(Manifest.parse(inApp))).toBe(true);
    expect(offersPlaces(Manifest.parse({ ...inApp, resources: ['library'] }))).toBe(false);
    const web = { ...inApp, sandbox: undefined, resources: ['place'] };
    expect(Manifest.safeParse(web).success).toBe(false);
  });

  it('reads a listing with a query, download addresses and places', () => {
    const parsed = LibraryResponse.parse({
      files: [
        {
          path: 'Author/Book/01.mp3',
          url: 'http://nas:4533/rest/stream?id=a',
          downloadUrl: 'http://nas:4533/rest/download?id=a',
          place: { positionMs: 1500, at: 1_700_000_000_000 },
        },
      ],
      query: { u: 'me', t: '0123456789abcdef0123456789abcdef', s: 'abc' },
    });
    expect(parsed.query).toEqual({ u: 'me', t: '0123456789abcdef0123456789abcdef', s: 'abc' });
    expect(parsed.files[0]?.place?.positionMs).toBe(1500);
  });

  it('takes query parameters with sane names and values only', () => {
    expect(QueryParams.safeParse({ u: 'jürgen' }).success).toBe(true);
    for (const bad of [{ 'a b': 'x' }, { a: 'x\ny' }, { a: 'x\u007f' }]) {
      expect(QueryParams.safeParse(bad).success).toBe(false);
    }
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`p${i}`, 'v']));
    expect(QueryParams.safeParse(many).success).toBe(false);
  });

  it('describes a place report', () => {
    const file = { path: 'A/B/01.mp3', url: 'http://nas/rest/stream?id=a' };
    const report = { file, files: [file], positionMs: 5, at: 1, finished: false };
    expect(PlaceReport.safeParse(report).success).toBe(true);
    expect(PlaceReport.safeParse({ ...report, positionMs: -1 }).success).toBe(false);
  });
});

describe('revision 7: signing in through a website, and a query for the browser', () => {
  const inApp: Manifest = {
    ...base,
    protocolVersion: 7,
    resources: ['library', 'signin'],
    sandbox: { hosts: ['plex.tv:443'] },
    settings: [
      { key: 'account', label: 'Plex account', type: 'signin', required: true },
      { key: 'url', label: 'Server address', type: 'url', host: true },
    ],
  };

  it('takes one signin field, with the signin resource, inside the app only', () => {
    expect(offersSignin(Manifest.parse(inApp))).toBe(true);
    expect(Manifest.safeParse({ ...inApp, resources: ['library'] }).success).toBe(false);
    const two = [...(inApp.settings ?? []), { key: 'b', label: 'B', type: 'signin' }];
    expect(Manifest.safeParse({ ...inApp, settings: two }).success).toBe(false);
    const web = { ...inApp, sandbox: undefined, settings: undefined, resources: ['signin'] };
    expect(Manifest.safeParse(web).success).toBe(false);
  });

  it('asks for a sign-in before a server is added, and keeps the value as it came', () => {
    const fields = inApp.settings ?? [];
    expect(readSettings(fields, {})).toEqual({ error: 'Plex account: sign in first.' });
    expect(readSettings(fields, { account: ' token ' })).toEqual({
      settings: { account: ' token ', url: '' },
    });
  });

  it('describes a sign-in: a code, an https page, and when to stop asking', () => {
    const start = { code: 'AB12', url: 'https://plex.tv/link', interval: 2, state: '1' };
    expect(SigninStart.safeParse(start).success).toBe(true);
    expect(SigninStart.safeParse({ ...start, url: 'http://plex.tv/link' }).success).toBe(false);
    expect(SigninStart.safeParse({ ...start, interval: 1 }).success).toBe(false);
    expect(SigninResult.parse({}).settings).toBeUndefined();
  });

  it('puts only the form’s own fields from a sign-in into the form', () => {
    const fields = inApp.settings ?? [];
    const result = { settings: { account: 'tok', url: 'https://a.plex.direct:32400', other: 'x' } };
    expect(applySignin(fields, { url: '' }, result, { hosts: true })).toEqual({
      account: 'tok',
      url: 'https://a.plex.direct:32400',
    });
    // Logging in again changes the sealed value only.
    const again = applySignin(fields, { url: 'http://nas:32400' }, result, {
      sealedOnly: true,
      hosts: true,
    });
    expect(again).toEqual({ account: 'tok', url: 'http://nas:32400' });
    // An add-on that doesn't come with the app can't pick its own hosts.
    expect(applySignin(fields, { url: '' }, result)).toEqual({ account: 'tok', url: '' });
  });

  it('reads a listing with headers and a query for the browser', () => {
    const parsed = LibraryResponse.parse({
      files: [],
      headers: { 'X-Plex-Token': 'tok' },
      webQuery: { 'X-Plex-Token': 'tok' },
    });
    expect(parsed.webQuery).toEqual({ 'X-Plex-Token': 'tok' });
  });
});
