/** The platform calls the add-ons need, injected so Workers, Node and tests can each provide them. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

/** A response cache keyed by URL, such as the Workers Cache API. */
export type ResponseCache = {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
};

export type Platform = {
  fetch: FetchLike;
  cache?: ResponseCache;
  /** Unix time in milliseconds; tests pin it. */
  now?: () => number;
};

export const TTL = {
  catalog: 6 * 60 * 60,
  item: 24 * 60 * 60,
  /** For best-effort answers that came back empty because an upstream failed. */
  failure: 5 * 60,
} as const;

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`Upstream answered ${status} for ${url}`);
  }
}

export type Upstream = {
  /** GETs JSON through the cache. Resolves `null` on 404. */
  json: (
    url: string,
    options: { ttl: number; headers?: Record<string, string> },
  ) => Promise<unknown>;
  now: () => number;
};

const TIMEOUT_MS = 10_000;

export function createUpstream(platform: Platform, userAgent: string): Upstream {
  const { fetch, cache } = platform;
  return {
    now: platform.now ?? Date.now,
    async json(url, { ttl, headers = {} }) {
      // Keyed by URL alone: auth headers (Podcast Index) change every request, the answer does not.
      const cached = await cache?.match(url).catch(() => undefined);
      if (cached) return cached.json();

      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': userAgent, ...headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new UpstreamError(response.status, url);
      const text = await response.text();
      const data: unknown = JSON.parse(text);
      if (cache) {
        const copy = new Response(text, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${ttl}`,
          },
        });
        await cache.put(url, copy).catch(() => undefined);
      }
      return data;
    },
  };
}
