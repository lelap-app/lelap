import type { Fetcher } from './client';

// Answers kept for as long as an add-on says (`cacheMaxAge`, M159). React Native's `fetch` keeps
// nothing on Android, and an add-on inside the app has no HTTP cache at all, so without this every
// screen asked again, whatever the add-on said.

/** The longest an answer is kept, whatever an add-on asks: a run of the app rarely lasts longer. */
export const MAX_ANSWER_SECONDS = 24 * 60 * 60;

/** Answers kept at once; the oldest go first. */
export const MAX_ANSWERS = 300;

// Only resources the protocol lets an add-on cache; the manifest and `/health` are always asked.
const CACHED = /\/(?:catalog|meta|stream|artwork|series)\/[^/]+\/[^?]+\.json(?:\?.*)?$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Seconds an answer may be used again: the body's `cacheMaxAge`, else `Cache-Control`'s
 * `max-age`; 0 when neither says, or the header says not to keep it.
 */
export function answerMaxAge(body: unknown, cacheControl: string | null | undefined): number {
  const field = isObject(body) ? body.cacheMaxAge : undefined;
  let seconds = 0;
  if (typeof field === 'number' && Number.isFinite(field)) {
    seconds = field;
  } else if (cacheControl && !/\bno-(?:store|cache)\b/i.test(cacheControl)) {
    seconds = Number(/\bmax-age\s*=\s*"?(\d+)/i.exec(cacheControl)?.[1] ?? 0);
  }
  return Math.max(0, Math.min(MAX_ANSWER_SECONDS, Math.floor(seconds)));
}

type Kept = { status: number; body: unknown; until: number };

/** Add-on answers by URL, each until its `cacheMaxAge` runs out. In memory only. */
export class AnswerCache {
  private readonly entries = new Map<string, Kept>();

  get(url: string, now: number): Kept | null {
    const kept = this.entries.get(url);
    if (!kept) return null;
    if (kept.until > now) return kept;
    this.entries.delete(url);
    return null;
  }

  set(url: string, kept: Kept): void {
    this.entries.delete(url);
    this.entries.set(url, kept);
    while (this.entries.size > MAX_ANSWERS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(url: string): void {
    this.entries.delete(url);
  }

  /** Forgets every answer under `base`, such as an add-on whose settings changed; all without. */
  forget(base?: string): void {
    if (base === undefined) return this.entries.clear();
    for (const url of [...this.entries.keys()]) if (url.startsWith(base)) this.entries.delete(url);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * A fetcher that answers again from `cache` while an add-on's answer is fresh. A request with
 * `cache: 'no-store'` (a second look, M152) always asks, and its answer replaces the kept one.
 */
export function cachingFetcher(
  fetcher: Fetcher,
  cache: AnswerCache,
  now: () => number = Date.now,
): Fetcher {
  return async (url, init) => {
    if (!CACHED.test(url)) return fetcher(url, init);
    if (init.cache !== 'no-store') {
      const kept = cache.get(url, now());
      if (kept) return { ok: true, status: kept.status, json: async () => kept.body };
    }
    const response = await fetcher(url, init);
    if (!response.ok) return response;
    // Read once here, so a `Response`'s getters are copied by hand rather than spread.
    const { status, headers } = response;
    const read = response.json().then(
      (body) => ({ body }),
      (error: unknown) => ({ error }),
    );
    const result = await read;
    if ('error' in result) {
      cache.delete(url);
      return { ok: true, status, json: () => Promise.reject(result.error) };
    }
    const { body } = result;
    const seconds = answerMaxAge(body, headers?.get('cache-control'));
    if (seconds > 0) cache.set(url, { status, body, until: now() + seconds * 1000 });
    else cache.delete(url);
    return { ok: true, status, json: async () => body, ...(headers ? { headers } : {}) };
  };
}
