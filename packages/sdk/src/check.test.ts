import { describe, expect, it } from 'vitest';

import { createAddon } from './addon';
import { type CheckFetch, checkAddon, formatReport, manifestUrlOf } from './check';
import { EXIT, runCli } from './cli';
import { PAGE_STYLE } from './config';
import type { Manifest, MetaPreview } from './protocol';

const BASE = 'https://addon.test';

const manifest: Manifest = {
  id: 'org.example.check',
  version: '1.0.0',
  protocol: 1,
  name: 'Check example',
  description: 'Two books.',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['example:'],
  catalogs: [{ type: 'audiobook', id: 'all', name: 'All', extra: [{ name: 'skip' }] }],
};

const BOOKS: MetaPreview[] = [
  { id: 'example:raven', type: 'audiobook', name: 'The Raven' },
  { id: 'example:a/b c', type: 'audiobook', name: 'A slash and a space' },
];

const good = createAddon({
  manifest,
  catalog: ({ extra }) => ({ metas: BOOKS.slice(Number(extra.skip ?? 0)), cacheMaxAge: 60 }),
  meta: ({ id }) => {
    const book = BOOKS.find((b) => b.id === id);
    return book ? { meta: book, cacheMaxAge: 60 } : null;
  },
  stream: ({ id }) => ({
    streams: [
      {
        sourceKey: `${id}:mp3`,
        name: 'Example',
        url: 'https://audio.test/raven.mp3',
        mime: 'audio/mpeg',
      },
    ],
    cacheMaxAge: 60,
  }),
});

const viaFetch =
  (handler: (request: Request) => Promise<Response> | Response): CheckFetch =>
  async (url, init) =>
    handler(new Request(url, init));

const json = (body: unknown, headers: Record<string, string> = {}, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/** A hand-written add-on with the mistakes people make. */
function broken(overrides: Record<string, () => Response> = {}): CheckFetch {
  return viaFetch((request) => {
    const path = new URL(request.url).pathname;
    const override = overrides[path];
    if (override) return override();
    if (path === '/manifest.json') return json(manifest);
    if (path.startsWith('/catalog/audiobook/all'))
      // Ignores skip, and the second item has no prefix.
      return json({
        metas: [
          { id: 'example:raven', type: 'audiobook', name: 'The Raven' },
          { id: 'raven', type: 'audiobook', name: 'The Raven again' },
        ],
      });
    if (path === '/meta/audiobook/example%3Araven.json')
      return json({ meta: { id: 'example:RAVEN', type: 'audiobook', name: 'The Raven' } });
    if (path === '/stream/audiobook/example%3Araven.json')
      return json({
        streams: [
          { sourceKey: 'a', name: 'Example', url: 'http://user:secret@audio.test/a.mp3' },
          { sourceKey: 'a', name: 'Example', parts: [{ url: 'https://audio.test/b.mp3' }] },
        ],
      });
    return json({ error: 'boom' }, {}, 500);
  });
}

describe('manifestUrlOf', () => {
  it('accepts what people paste', () => {
    expect(manifestUrlOf('https://a.test/x/')).toBe('https://a.test/x/manifest.json');
    expect(manifestUrlOf('lelap://a.test/manifest.json')).toBe('https://a.test/manifest.json');
    expect(manifestUrlOf('ftp://a.test')).toBeNull();
    expect(manifestUrlOf('not a url')).toBeNull();
  });
});

describe('checkAddon', () => {
  it('passes an add-on made with createAddon', async () => {
    const report = await checkAddon(BASE, { fetch: viaFetch(good.fetch) });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.addon).toEqual({ id: manifest.id, name: manifest.name, version: '1.0.0' });
    // Manifest, health, the revision 15 preflight, two catalog pages, the far page, an unknown
    // catalog, meta and stream for two items, an unknown meta.
    expect(report.requests).toBe(12);
  });

  it('says what is wrong with a hand-written one', async () => {
    const report = await checkAddon(BASE, { fetch: broken() });
    expect(report.ok).toBe(false);
    const said = report.problems.map((p) => `${p.level} ${p.kind} ${p.field ?? ''} ${p.message}`);
    expect(said).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^error cors {2}No Access-Control-Allow-Origin.*more addresses/),
        expect.stringMatching(
          /^error catalog metas\[1\]\.id IDs look like prefix:value\. Got "raven"/,
        ),
        expect.stringMatching(/^warning caching/),
        expect.stringMatching(/^warning paging {2}skip=2 brings only items earlier pages listed/),
        expect.stringMatching(/^error paging {2}skip=100000 still brings the first items/),
        expect.stringMatching(/^error ids meta\.id Asked for example:raven and got example:RAVEN/),
        expect.stringMatching(/^error stream streams\[0\]\.url The address carries a login/),
        expect.stringMatching(/^warning stream streams\[0\]\.url Plain http/),
        expect.stringMatching(
          /^warning stream streams\[1\]\.parts Parts without durationMs came with revision 14/,
        ),
        expect.stringMatching(/^error stream streams\[1\]\.sourceKey Two streams share sourceKey/),
        expect.stringMatching(/^error catalog {2}Answered 500 for a catalog it does not list/),
        expect.stringMatching(/^error meta {2}Answered 500 for an ID it does not know/),
      ]),
    );
    expect(report.errors).toBe(report.problems.filter((p) => p.level === 'error').length);
  });

  it('stops at a manifest the app refuses', async () => {
    const report = await checkAddon(BASE, {
      fetch: broken({
        '/manifest.json': () =>
          json(
            { ...manifest, protocol: 2, types: ['book'] },
            { 'Access-Control-Allow-Origin': '*' },
          ),
      }),
    });
    expect(report.problems.map((p) => [p.field, p.message])).toEqual([
      ['protocol', 'Expected 1. Got 2.'],
      ['types[0]', 'Expected one of "audiobook"|"podcast"|"episode". Got "book".'],
    ]);
    expect(report.requests).toBe(1);
    expect(report.notes[0]).toMatch(/refuses this manifest/);
  });

  it('reports an add-on that cannot be reached', async () => {
    const report = await checkAddon(BASE, {
      fetch: async () => {
        throw new Error('connection refused');
      },
    });
    expect(report.problems).toEqual([
      {
        level: 'error',
        kind: 'http',
        url: `${BASE}/manifest.json`,
        message: 'Could not be reached: connection refused.',
      },
    ]);
  });

  it('gives up on a slow answer as the app does', async () => {
    const report = await checkAddon(BASE, {
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    });
    expect(report.problems[0]?.message).toBe('No answer within 0.0 s; the app gives up then.');
  });

  it('gives up on a fetch that ignores the signal', async () => {
    const report = await checkAddon(BASE, { timeoutMs: 20, fetch: () => new Promise(() => {}) });
    expect(report.problems[0]?.message).toBe('No answer within 0.0 s; the app gives up then.');
  });

  it('keeps a query in the address on every request', async () => {
    const asked: string[] = [];
    const report = await checkAddon(`${BASE}/sub/manifest.json?key=1`, {
      fetch: (url, init) => {
        asked.push(url);
        const request = new Request(url, init);
        return good.fetch(new Request(request.url.replace('/sub/', '/'), request));
      },
    });
    expect(report.ok).toBe(true);
    expect(asked[0]).toBe(`${BASE}/sub/manifest.json?key=1`);
    expect(asked.every((url) => url.startsWith(`${BASE}/sub/`) && url.endsWith('?key=1'))).toBe(
      true,
    );
  });

  it('says when the request budget stopped it', async () => {
    const report = await checkAddon(BASE, { fetch: viaFetch(good.fetch), maxRequests: 3 });
    expect(report.requests).toBe(3);
    expect(report.problems.map((p) => p.message)).toEqual([
      expect.stringMatching(/^Stopped after 3 requests/),
    ]);
  });

  it('checks the configure page and skips resources that need settings', async () => {
    const configured = createAddon({
      manifest,
      configure: { fields: [{ key: 'name', label: 'Name', type: 'text', required: true }] },
      catalog: () => ({ metas: [] }),
    });
    const report = await checkAddon(BASE, { fetch: viaFetch(configured.fetch) });
    expect(report.problems).toEqual([]);
    expect(report.notes).toEqual([expect.stringMatching(/must be configured first/)]);

    const own = await checkAddon(BASE, {
      fetch: viaFetch((request) =>
        new URL(request.url).pathname === '/configure'
          ? new Response('<p>Hi</p>', { headers: { 'Content-Type': 'text/html' } })
          : configured.fetch(request),
      ),
    });
    expect(own.problems.map((p) => p.message)).toEqual([
      expect.stringMatching(/^Does not use the shared page style/),
      expect.stringMatching(/^No Referrer-Policy/),
    ]);
    expect(PAGE_STYLE.length).toBeGreaterThan(0);
  });

  it('notes an add-on inside the app instead of checking it', async () => {
    const report = await checkAddon(BASE, {
      fetch: broken({
        '/manifest.json': () =>
          json(
            { ...manifest, sandbox: { hosts: ['books.test'] } },
            { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=60' },
          ),
      }),
    });
    expect(report.problems).toEqual([]);
    expect(report.notes[0]).toMatch(/inside the app/);
  });

  it('probes audio on request', async () => {
    const fetch: CheckFetch = async (url, init) =>
      url.startsWith('https://audio.test/')
        ? new Response('ab', { status: 200, headers: { 'Content-Type': 'text/html' } })
        : good.fetch(new Request(url, init));
    const report = await checkAddon(BASE, { fetch, audio: true, items: 1 });
    expect(report.problems.map((p) => [p.kind, p.message])).toEqual([
      ['audio', 'Content-Type is text/html, not audio.'],
      [
        'audio',
        'Ignores Range requests: the listener cannot seek before the whole file has loaded.',
      ],
    ]);
  });

  it('checks the scrobble preflight', async () => {
    const scrobbling = createAddon({
      manifest: { ...manifest, resources: [...manifest.resources, 'scrobble'] },
      catalog: () => ({ metas: [], cacheMaxAge: 60 }),
      scrobble: () => undefined,
    });
    const report = await checkAddon(BASE, { fetch: viaFetch(scrobbling.fetch) });
    expect(report.problems.filter((p) => p.kind === 'scrobble')).toEqual([]);
    const refusing = await checkAddon(BASE, {
      fetch: viaFetch((request) =>
        request.method === 'OPTIONS'
          ? new Response(null, { status: 405 })
          : scrobbling.fetch(request),
      ),
    });
    expect(refusing.problems.filter((p) => p.kind === 'scrobble')).toHaveLength(1);
  });
});

describe('runCli', () => {
  const run = async (args: string[], fetch: CheckFetch = viaFetch(good.fetch)) => {
    let out = '';
    const code = await runCli(args, { write: (text) => (out += text), fetch });
    return { code, out };
  };

  it('exits 0 for a passing add-on and 1 for problems', async () => {
    expect((await run(['check', BASE])).code).toBe(EXIT.ok);
    const failed = await run(['check', BASE], broken());
    expect(failed.code).toBe(EXIT.problems);
    expect(failed.out).toContain(
      'error   ids  https://addon.test/meta/audiobook/example%3Araven.json',
    );
    expect(failed.out).toMatch(/Failed: \d+ errors, \d+ warnings?, \d+ requests\.\n$/);
  });

  it('prints JSON for CI', async () => {
    const { code, out } = await run(['check', BASE, '--json'], broken());
    expect(code).toBe(EXIT.problems);
    const report = JSON.parse(out);
    expect(report.ok).toBe(false);
    expect(report.problems[0]).toHaveProperty('level');
  });

  it('fails on warnings with --strict', async () => {
    const warnOnly = viaFetch(async (request) => {
      const response = await good.fetch(request);
      response.headers.delete('Content-Type');
      return response;
    });
    expect((await run(['check', BASE], warnOnly)).code).toBe(EXIT.ok);
    expect((await run(['check', BASE, '--strict'], warnOnly)).code).toBe(EXIT.problems);
  });

  it('exits 2 when used wrongly', async () => {
    expect((await run([])).code).toBe(EXIT.usage);
    expect((await run(['check'])).code).toBe(EXIT.usage);
    expect((await run(['check', BASE, '--items', 'many'])).code).toBe(EXIT.usage);
    expect((await run(['check', BASE, '--id', 'book:x'])).code).toBe(EXIT.usage);
    expect((await run(['check', 'ftp://a.test'])).code).toBe(EXIT.usage);
    expect((await run(['check', BASE, '--timeout', '0'])).code).toBe(EXIT.usage);
    expect((await run(['check', BASE, '--items', ''])).code).toBe(EXIT.usage);
    expect((await run(['--help'])).code).toBe(EXIT.ok);
    // A search for "-h" is a search, not a request for help.
    expect((await run(['check', BASE, '--search', '-h'])).code).toBe(EXIT.ok);
  });

  it('checks an item passed with --id', async () => {
    const { out } = await run(['check', BASE, '--id', 'audiobook:example:gone', '--json']);
    const report = JSON.parse(out);
    expect(report.problems[0].message).toMatch(/^Not found: example:gone\.$/);
  });

  it('formats a report', () => {
    expect(
      formatReport({
        url: `${BASE}/manifest.json`,
        addon: null,
        ok: true,
        errors: 0,
        warnings: 0,
        requests: 1,
        problems: [],
        notes: [],
      }),
    ).toBe(`Add-on check\n${BASE}/manifest.json\n\nPassed: 0 errors, 0 warnings, 1 request.\n`);
  });
});
