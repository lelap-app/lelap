import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAddon } from './addon';
import { mockFetch } from './check';
import { configurePage } from './config';
import { fingerprint, log } from './credentials';
import type { Manifest } from './protocol';

const manifest: Manifest = {
  id: 'org.example.wait',
  version: '1.0.0',
  protocol: 1,
  name: 'Wait',
  description: 'Tests',
  types: ['audiobook'],
  resources: ['stream'],
  catalogs: [],
};

describe('waitUntil', () => {
  it('hands work after the answer to the execution context', async () => {
    const later: Promise<unknown>[] = [];
    let finished = false;
    const addon = createAddon({
      manifest,
      stream: ({ waitUntil }) => {
        waitUntil(
          new Promise<void>((resolve) => setTimeout(resolve, 5)).then(() => {
            finished = true;
          }),
        );
        return { streams: [] };
      },
    });
    const response = await addon.fetch(
      new Request('https://addon.test/stream/audiobook/x.json'),
      {},
      { waitUntil: (p) => void later.push(p) },
    );
    expect(response.status).toBe(200);
    expect(finished).toBe(false);
    expect(later).toHaveLength(1);
    await Promise.all(later);
    expect(finished).toBe(true);
  });

  it('runs without a context and reports a rejection to onError', async () => {
    const onError = vi.fn();
    const addon = createAddon(
      {
        manifest,
        stream: ({ waitUntil }) => {
          waitUntil(Promise.reject(new Error('late')));
          return { streams: [] };
        },
      },
      { onError },
    );
    const response = await addon.fetch(new Request('https://addon.test/stream/audiobook/x.json'));
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('configure field link and group', () => {
  const page = configurePage({
    name: 'Example',
    description: 'd',
    fields: [
      { key: 'token', label: 'API key', type: 'text', group: 'Account' },
      { key: 'lang', label: 'Language', type: 'text' },
      {
        key: 'user',
        label: 'User',
        type: 'text',
        group: 'Account',
        link: { href: 'https://example.org/keys', text: 'Find your API key' },
      },
      { key: 'mp3', label: 'MP3 only', type: 'checkbox', group: 'Files' },
    ],
  });

  it('puts ungrouped fields first, then each group under a heading', () => {
    const order = ['f-lang', '<h2>Account</h2>', 'f-token', 'f-user', '<h2>Files</h2>', 'f-mp3'];
    const at = order.map((part) => page.indexOf(part));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('shows the link beside its field', () => {
    expect(page).toContain('href="https://example.org/keys"');
    expect(page).toContain('Find your API key');
  });

  it('refuses a link that is not http or https', () => {
    expect(() =>
      createAddon({
        manifest,
        configure: {
          fields: [
            {
              key: 'a',
              label: 'A',
              type: 'text',
              link: { href: 'javascript:alert(1)', text: 'x' },
            },
          ],
        },
      }),
    ).toThrow(/link/);
  });
});

describe('fingerprint and log', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives a short stable hash that differs per secret', async () => {
    const a = await fingerprint('token-a');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await fingerprint('token-a')).toBe(a);
    expect(await fingerprint('token-b')).not.toBe(a);
  });

  it('prints one JSON line and drops what could carry a key', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(line));
    log('search', {
      url: 'https://user:pw@api.example.org/search?q=x&key=SECRET#k',
      count: 3,
      cached: false,
      error: new Error('key=SECRET') as unknown as string,
    });
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(line).toEqual({
      event: 'search',
      url: 'https://api.example.org/search',
      count: 3,
      cached: false,
      error: '[dropped]',
    });
    expect(lines[0]).not.toContain('SECRET');
  });
});

describe('mockFetch', () => {
  it('answers the routes given and fails the rest', async () => {
    const fetch = mockFetch({
      'https://archive.org/metadata/raven': { files: [] },
      'POST https://api.example.org/*': 'posted',
      'https://archive.org/*': new Response('gone', { status: 410 }),
    });
    expect(await (await fetch('https://archive.org/metadata/raven')).json()).toEqual({
      files: [],
    });
    expect((await fetch('https://archive.org/other')).status).toBe(410);
    expect((await fetch('https://archive.org/other')).status).toBe(410);
    expect(await (await fetch('https://api.example.org/x', { method: 'POST' })).text()).toBe(
      'posted',
    );
    await expect(fetch('https://api.example.org/x')).rejects.toThrow(/no route for GET/);
    expect(fetch.unmatched.map((r) => r.url)).toEqual(['https://api.example.org/x']);
    expect(fetch.calls).toHaveLength(5);
  });
});
