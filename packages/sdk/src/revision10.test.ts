import { describe, expect, it, vi } from 'vitest';

import { createAddon } from './addon';
import { type CheckFetch, checkAddon } from './check';
import { catalogPath } from './paths';
import { Manifest, ScrobbleEvent, wantsScrobble } from './protocol';

// Revision 10: events on the scrobble resource, a `rate` without a rating, and the SDK's
// configure grown into what Lelap's own scrobblers need (a second page, old addresses).

const PASSWORD = 'correct-horse-battery-staple';

const base = {
  id: 'org.example.tracker',
  version: '1.0.0',
  protocol: 1 as const,
  name: 'Tracker',
  description: 'Keeps a reading log',
  types: ['audiobook' as const],
  catalogs: [],
};

describe('scrobble events', () => {
  it('sends a scrobbler only the events it lists', () => {
    const tracker = Manifest.parse({
      ...base,
      resources: [{ name: 'scrobble', events: ['finish', 'rate'] }],
    });
    expect(wantsScrobble(tracker, 'audiobook', undefined, 'rate')).toBe(true);
    expect(wantsScrobble(tracker, 'audiobook', undefined, 'progress')).toBe(false);
    // Without an event, the question is only whether it scrobbles this type.
    expect(wantsScrobble(tracker, 'audiobook')).toBe(true);
    const all = Manifest.parse({ ...base, resources: ['scrobble'] });
    expect(wantsScrobble(all, 'audiobook', undefined, 'rate')).toBe(true);
  });

  it('refuses unknown or empty event lists', () => {
    const resources = (events: string[]) => [{ name: 'scrobble', events }];
    expect(Manifest.safeParse({ ...base, resources: resources(['skip']) }).success).toBe(false);
    expect(Manifest.safeParse({ ...base, resources: resources([]) }).success).toBe(false);
  });

  it('takes a rate without a rating as the rating taken back', () => {
    const event = {
      eventId: 'evt-12345678',
      event: 'rate',
      at: 1,
      item: { type: 'audiobook', name: 'Walden' },
    };
    expect(ScrobbleEvent.safeParse(event).success).toBe(true);
    expect(ScrobbleEvent.safeParse({ ...event, rating: 4.5 }).success).toBe(true);
    expect(ScrobbleEvent.safeParse({ ...event, rating: 4.25 }).success).toBe(false);
  });
});

describe('the add-on check, for revision 10', () => {
  const editions = (keys: string[]) =>
    keys.map((key) => ({ key, name: `Edition ${key}`, narrators: ['A. Reader'] }));
  const book = (id: string, keys: string[]) => ({
    id,
    type: 'audiobook' as const,
    name: 'Walden',
    editions: editions(keys),
  });
  const library = createAddon({
    manifest: {
      ...base,
      idPrefixes: ['ex:'],
      resources: [
        'catalog',
        'meta',
        { name: 'scrobble', events: ['finish', 'rate'] },
        { name: 'catalog', events: ['rate'] },
      ],
      catalogs: [{ type: 'audiobook', id: 'all', name: 'All' }],
    },
    catalog: () => ({
      metas: [book('ex:twice', ['a', 'a']), book('ex:one', ['a'])],
      cacheMaxAge: 60,
    }),
    meta: ({ id }) => ({
      meta: id === 'ex:twice' ? book(id, ['a', 'b', 'a']) : book(id, ['a']),
      cacheMaxAge: 60,
    }),
    scrobble: () => undefined,
  });
  const fetch: CheckFetch = async (url, init) => library.fetch(new Request(url, init));

  it('warns of events off the scrobble resource and editions the app can’t tell apart', async () => {
    const report = await checkAddon('https://addon.test', { fetch });
    const said = report.problems.map((p) => `${p.field ?? ''} ${p.message}`);
    expect(said).toContain('resources[3].events Only scrobble takes events; catalog ignores them.');
    expect(said).toContain(
      'meta.editions[2].key Two editions have the key “a”, so choosing one may show the other.',
    );
    expect(said.some((s) => s.startsWith('meta.editions One edition only'))).toBe(true);
    expect(said.some((s) => s.startsWith('resources[2]'))).toBe(false);
  });
});

describe('createAddon with a second configure page', () => {
  const manifest: Manifest = {
    ...base,
    id: 'org.example.shelf',
    name: 'Shelf',
    resources: ['catalog'],
  };
  const preview = { id: 'test:1', type: 'audiobook' as const, name: 'One' };
  const lists = [
    { value: '1', label: 'Sci-fi' },
    { value: '2', label: 'Summer' },
  ];
  let clock = 1_000_000;
  const errors: unknown[] = [];
  const legacy = vi.fn((segment: string) =>
    segment === 'v1.old' ? { token: 'old-token-from-before', lists: ['2'] } : null,
  );
  const shelf = createAddon(
    {
      manifest,
      configure: {
        secret: 'test secret',
        text: {
          intro: 'Shows your lists.',
          link: { href: 'https://service.example/tokens', label: 'Make a token' },
          steps: ['Make a token.', 'Paste it below.'],
          note: 'Revoke it there any time.',
        },
        fields: [
          { key: 'token', label: 'Token', type: 'password', required: true },
          { key: 'server', label: 'Server', type: 'url', placeholder: 'https://…' },
        ],
        check: (config) => {
          if (config.token === 'service-down') throw new Error('service down');
          return String(config.token).length < 8 ? 'Too short.' : undefined;
        },
        choose: {
          intro: 'Choose the rows.',
          fields: () => [
            { key: 'lists', label: 'Your lists', type: 'choices', options: lists, default: ['1'] },
          ],
          apply: (config, chosen) =>
            Array.isArray(chosen.lists) && chosen.lists.length > 1
              ? 'Pick one list.'
              : { ...config, ...chosen },
        },
        manifest: (config) => ({
          ...manifest,
          catalogs: (Array.isArray(config.lists) ? config.lists : []).map((id) => ({
            type: 'audiobook' as const,
            id: `list-${id}`,
            name: `List ${id}`,
          })),
        }),
        legacy: { prefix: 'v1.', open: legacy },
      },
      catalog: ({ id }) => ({ metas: [{ ...preview, name: id }] }),
    },
    { basePath: '/shelf', now: () => clock, onError: (error) => errors.push(error) },
  );
  const at = (path: string) => `https://addon.example/shelf/${path}`;
  const get = (path: string) => shelf.fetch(new Request(at(path)));
  const post = (path: string, body: string[][] | Record<string, string>) =>
    shelf.fetch(new Request(at(path), { method: 'POST', body: new URLSearchParams(body) }));
  const draftOf = (text: string) => /name="draft" value="([^"]+)"/.exec(text)?.[1] ?? '';

  it('shows the intro, link, steps and fields of the first page', async () => {
    const text = await (await get('configure')).text();
    expect(text).toContain('Shows your lists.');
    expect(text).toContain('class="button" href="https://service.example/tokens"');
    expect(text).toContain('<li>Paste it below.</li>');
    expect(text).toContain('type="url"');
    expect(text).toContain('placeholder="https://…"');
    expect(text).toContain('>Next<');
  });

  it('checks the address and the token before the second page', async () => {
    const bad = await post('configure', { token: 'long-enough', server: 'ftp://x' });
    expect(await bad.text()).toContain('Server: an http:// or https:// address');
    expect(await (await post('configure', { token: 'short' })).text()).toContain('Too short.');
    const down = await post('configure', { token: 'service-down' });
    expect(await down.text()).toContain('could not check these settings');
    expect(errors).toHaveLength(1);
  });

  it('carries the first page sealed to the second and makes a link with the choices', async () => {
    const second = await (await post('configure', { token: PASSWORD })).text();
    expect(second).toContain('Choose the rows.');
    expect(second).not.toContain(PASSWORD);
    expect(second).toMatch(/value="1" checked/);
    const draft = draftOf(second);
    expect(draft).toMatch(/^e2\./);

    const twice = [
      ['draft', draft],
      ['lists', '1'],
      ['lists', '2'],
    ];
    const refused = await (await post('configure', twice)).text();
    expect(refused).toContain('Pick one list.');
    // The ticks stay as sent.
    expect(refused).toMatch(/value="2" checked/);

    const done = await (
      await post('configure', [
        ['draft', draft],
        ['lists', '2'],
      ])
    ).text();
    expect(done).toContain('class="copy"');
    const manifestUrl =
      /(https:\/\/addon\.example\/shelf\/e2\.[A-Za-z0-9_-]+\/manifest\.json)/.exec(done)?.[1] ?? '';
    const served = (await (await shelf.fetch(new Request(manifestUrl))).json()) as Manifest;
    expect(served.catalogs.map((c) => c.id)).toEqual(['list-2']);
    const token = manifestUrl.split('/')[4] ?? '';
    expect((await get(`${token}/${catalogPath('audiobook', 'list-2')}`)).status).toBe(200);
    expect((await get(`${token}/${catalogPath('audiobook', 'list-1')}`)).status).toBe(404);
  });

  it('runs a draft out after an hour, and never takes one as a link', async () => {
    const second = await (await post('configure', { token: PASSWORD })).text();
    const draft = draftOf(second);
    expect((await get(`${draft}/manifest.json`)).status).toBe(403);
    clock += 61 * 60 * 1000;
    const late = await post('configure', [
      ['draft', draft],
      ['lists', '1'],
    ]);
    expect(await late.text()).toContain('These settings ran out.');
  });

  it('opens addresses from before, and configuring again keeps their choices', async () => {
    const served = (await (await get('v1.old/manifest.json')).json()) as Manifest;
    expect(served.catalogs.map((c) => c.id)).toEqual(['list-2']);
    expect(served.behaviorHints?.configurationRequired).toBe(false);
    expect((await get('v1.nope/manifest.json')).status).toBe(403);
    // From the link, the choices open first, with the way back to the token.
    const fromLink = await (await get('v1.old/configure')).text();
    expect(fromLink).toContain('Choose the rows.');
    expect(fromLink).toContain('href="configure?start=1"');
    expect(await (await get('v1.old/configure?start=1')).text()).toContain('name="token"');
    // An empty token keeps the old one; the second page starts from the old choices.
    const second = await (await post('v1.old/configure', { token: '' })).text();
    expect(second).toMatch(/value="2" checked/);
    expect(second).not.toMatch(/value="1" checked/);
  });
});
