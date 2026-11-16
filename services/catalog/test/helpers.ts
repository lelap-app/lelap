import { readFileSync } from 'node:fs';

import type { FetchLike, Platform } from '../src/upstream';

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/${name}`, 'utf8'));
}

type Route = [match: (url: URL) => boolean, body: unknown, status?: number];

export type FakeFetch = FetchLike & {
  calls: { url: URL; headers: Record<string, string> }[];
};

/** A `fetch` that answers from fixtures; unmatched URLs get a 404 like the real APIs. */
export function fakeFetch(routes: Route[]): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const fetch = async (url: string, init: { headers: Record<string, string> }) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, headers: init.headers });
    const route = routes.find(([match]) => match(parsed));
    if (!route) return new Response('{"error":"not found"}', { status: 404 });
    const [, body, status = 200] = route;
    return new Response(JSON.stringify(body), { status });
  };
  return Object.assign(fetch, { calls });
}

export const path = (pathname: string) => (url: URL) => url.pathname === pathname;

export const platform = (fetch: FetchLike): Platform => ({ fetch, now: () => 1_762_905_600_000 });
