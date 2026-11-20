import { describe, expect, it } from 'vitest';

import { endMessage, probeStream, type ProbeFetcher, retryAfterSeconds } from './preparing';

const now = Date.UTC(2026, 10, 20, 12, 0, 0);

const answer =
  (status: number, headers: Record<string, string> = {}, body = ''): ProbeFetcher =>
  async () => ({
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  });

describe('retryAfterSeconds', () => {
  it('reads seconds and HTTP dates, held between 5 seconds and an hour', () => {
    expect(retryAfterSeconds('120', now)).toBe(120);
    expect(retryAfterSeconds('1', now)).toBe(5);
    expect(retryAfterSeconds('86400', now)).toBe(3600);
    expect(retryAfterSeconds(new Date(now + 90_000).toUTCString(), now)).toBe(90);
    expect(retryAfterSeconds('soon', now)).toBeNull();
    expect(retryAfterSeconds(null, now)).toBeNull();
  });
});

describe('endMessage', () => {
  it('keeps a short plain-text reason', () => {
    expect(endMessage('text/plain; charset=utf-8', 'The source no longer has this file.\n')).toBe(
      'The source no longer has this file.',
    );
    expect(endMessage('text/html', '<p>Gone</p>')).toBeNull();
    expect(endMessage('text/plain', 'x'.repeat(201))).toBeNull();
  });
});

describe('probeStream', () => {
  it('says an Internet Archive item still being derived is preparing', async () => {
    const state = await probeStream(
      answer(503, { 'retry-after': '30' }),
      'https://a.test/x.mp3',
      now,
    );
    expect(state).toEqual({ state: 'preparing', seconds: 30 });
  });

  it('takes a 503 without Retry-After, and any failure, for ready: the player says what is wrong', async () => {
    expect(await probeStream(answer(503), 'https://a.test/x.mp3', now)).toEqual({ state: 'ready' });
    const failing: ProbeFetcher = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await probeStream(failing, 'https://a.test/x.mp3', now)).toEqual({ state: 'ready' });
  });

  it('ends the wait on 404 and 410 with the add-on’s words', async () => {
    const state = await probeStream(
      answer(410, { 'content-type': 'text/plain' }, 'The source no longer has this file.'),
      'https://a.test/x.mp3',
      now,
    );
    expect(state).toEqual({
      state: 'gone',
      status: 410,
      message: 'The source no longer has this file.',
    });
  });

  it('asks for one byte, past every cache', async () => {
    let seen: Parameters<ProbeFetcher>[1] | undefined;
    const fetcher: ProbeFetcher = async (_url, init) => {
      seen = init;
      return answer(206)('', init);
    };
    await probeStream(fetcher, 'https://a.test/x.mp3', now);
    expect(seen?.headers.Range).toBe('bytes=0-0');
    expect(seen?.cache).toBe('no-store');
  });
});
