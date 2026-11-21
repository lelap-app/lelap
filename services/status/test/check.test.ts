import { describe, expect, it } from 'vitest';

import { checkAll, checkTarget, parseTargets } from '../src/check';

const target = { name: 'Proxy', url: 'https://proxy.example.org/health' };

describe('parseTargets', () => {
  it('fills variables and leaves out lines whose variable is unset', () => {
    const text = `
Landing page | https://{LELAP_DOMAIN}/
Web app | {WEB_ORIGIN}/
Proxy | https://{PROXY_DOMAIN}/health
not a target
Bad | ftp://{LELAP_DOMAIN}/
Landing page | https://other.example.org/
`;
    expect(
      parseTargets(text, {
        LELAP_DOMAIN: 'example.org',
        WEB_ORIGIN: 'https://listen.example.org',
        PROXY_DOMAIN: ' ',
      }),
    ).toEqual([
      { name: 'Landing page', url: 'https://example.org/' },
      { name: 'Web app', url: 'https://listen.example.org/' },
    ]);
  });
});

describe('checkTarget', () => {
  it('counts a 200 as up, with the time taken', async () => {
    let t = 0;
    const result = await checkTarget(
      () => {
        t += 42;
        return Promise.resolve(new Response('ok'));
      },
      target,
      1000,
      () => t,
    );
    expect(result).toEqual({ ...target, up: true, status: 200, ms: 42, error: null });
  });

  it('counts a 500 as down', async () => {
    const result = await checkTarget(
      () => Promise.resolve(new Response('no', { status: 500 })),
      target,
    );
    expect(result).toMatchObject({ up: false, status: 500, error: 'HTTP 500' });
  });

  it('believes a health answer that says it is down', async () => {
    const result = await checkTarget(
      () =>
        Promise.resolve(
          Response.json({ status: 'down', message: 'Open Library is not answering' }),
        ),
      target,
    );
    expect(result).toMatchObject({
      up: false,
      status: 200,
      error: 'Open Library is not answering',
    });
    const degraded = await checkTarget(
      () => Promise.resolve(Response.json({ status: 'degraded' })),
      target,
    );
    expect(degraded.up).toBe(true);
  });

  it('gives up after the timeout', async () => {
    const hanging = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const result = await checkTarget(hanging, target, 20);
    expect(result).toMatchObject({ up: false, status: null });
    expect(result.error).toMatch(/^No answer within/);
  });

  it('reports a refused connection', async () => {
    const result = await checkTarget(
      () => Promise.reject(new TypeError('connect ECONNREFUSED')),
      target,
    );
    expect(result).toMatchObject({ up: false, status: null, error: 'connect ECONNREFUSED' });
  });

  it('asks every target once', async () => {
    const asked: string[] = [];
    const results = await checkAll(
      (url) => {
        asked.push(url);
        return Promise.resolve(new Response('ok'));
      },
      [target, { name: 'Sync', url: 'https://sync.example.org/health' }],
    );
    expect(asked).toHaveLength(2);
    expect(results.map((r) => r.up)).toEqual([true, true]);
  });
});
