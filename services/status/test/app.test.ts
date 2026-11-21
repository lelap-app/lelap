import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { bodyOf, rawMessage, subjectOf } from '../src/email';
import { duration, percent } from '../src/page';
import { createStore } from '../src/store';
import { memorySql } from './sql';

const NOW = Date.UTC(2026, 10, 20, 14, 5);

function setup(now = NOW) {
  const store = createStore(memorySql());
  store.record(
    [
      {
        name: 'Proxy',
        url: 'https://proxy.example.org/health',
        up: true,
        status: 200,
        ms: 31,
        error: null,
      },
      {
        name: 'Sync <b>',
        url: 'https://sync.example.org/',
        up: false,
        status: null,
        ms: 10_000,
        error: 'No answer within 10 s',
      },
    ],
    NOW,
  );
  const app = createApp(
    () => Promise.resolve(store.snapshot()),
    () => now,
  );
  return (path: string) => app.request(`https://status.example.org${path}`);
}

describe('page', () => {
  it('shows each target, escaped, with no script and no outside requests', async () => {
    const response = await setup()('/');
    expect(response.status).toBe(200);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    const html = await response.text();
    expect(html).toContain('<title>Sync &lt;b&gt; is down · Lelap status</title>');
    expect(html).toContain('No answer within 10 s');
    expect(html).toContain('31 ms');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/(src|href)="https?:\/\/(?!proxy\.example\.org|sync\.example\.org)/);
    expect(html.match(/<li class="(ok|some|down|none)"/g)).toHaveLength(48);
  });

  it('says when the checker has not run lately', async () => {
    const html = await (await setup(NOW + 60 * 60_000)('/')).text();
    expect(html).toContain('the checker itself may be stuck');
  });

  it('answers before the first check', async () => {
    const app = createApp(() => Promise.resolve(null));
    expect(await (await app.request('/')).text()).toContain('No checks yet');
    expect(await (await app.request('/status.json')).json()).toMatchObject({
      up: null,
      targets: [],
    });
  });

  it('gives the same as JSON', async () => {
    const response = await setup()('/status.json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = (await response.json()) as {
      up: boolean;
      checkedAt: string;
      targets: { name: string; up: boolean; hours: unknown[] }[];
    };
    expect(body.up).toBe(false);
    expect(body.checkedAt).toBe('2026-11-20T14:05:00.000Z');
    expect(body.targets.map((t) => [t.name, t.up])).toEqual([
      ['Proxy', true],
      ['Sync <b>', false],
    ]);
    expect(body.targets[0]?.hours).toHaveLength(24);
  });

  it('rounds and words numbers for people', () => {
    expect(percent(null)).toBe('–');
    expect(percent(1)).toBe('100%');
    expect(percent(0.99999)).toBe('99.9%');
    expect(duration(30_000)).toBe('under a minute');
    expect(duration(25 * 60_000)).toBe('25 minutes');
    expect(duration(3 * 24 * 60 * 60_000)).toBe('3 days');
  });
});

describe('email', () => {
  const down = {
    name: 'Proxy',
    url: 'https://proxy.example.org/health',
    up: false,
    error: 'HTTP 502',
    lastedMs: 2 * 60 * 60_000,
  };

  it('words one change or several', () => {
    expect(subjectOf([down])).toBe('Lelap status: Proxy is down');
    expect(subjectOf([{ ...down, up: true }])).toBe('Lelap status: Proxy is up again');
    expect(subjectOf([down, { ...down, name: 'Sync' }])).toBe('Lelap status: 2 changes, 2 down');
    expect(bodyOf([down], NOW)).toContain('Proxy is down: HTTP 502. It was up for 2 hours.');
  });

  it('builds a message whose headers a name cannot break', () => {
    const raw = rawMessage(
      'status@example.org',
      'me@example.net',
      [{ ...down, name: 'Pröxy\r\nBcc: x@y' }],
      NOW,
      'https://status.example.org/',
    );
    const [head] = raw.split('\r\n\r\n');
    expect(head?.split('\r\n').some((line) => line.startsWith('Bcc'))).toBe(false);
    expect(head).toMatch(/^Subject: =\?UTF-8\?B\?/m);
    expect(raw).toContain('https://status.example.org/');
  });
});
