import { HealthResponse, type HealthStatus } from '@lelap/sdk';

import { addonBase, type Fetcher, type InstalledAddon, normalizeManifestUrl } from './client';

/** What the app saw of one add-on during this run. Nothing is stored or sent anywhere. */
export type AddonHealth = {
  /** When the add-on last answered, and how long that took. */
  lastOkAt: number | null;
  lastLatencyMs: number | null;
  lastError: { message: string; status: number | null; at: number } | null;
  /** What its own `/health` said last. */
  reported: { status: HealthStatus; message: string | null; at: number } | null;
};

export type HealthState = 'unknown' | 'ok' | 'slow' | 'degraded' | 'failing';

/** Answers slower than this mark an add-on as slow. */
export const SLOW_MS = 3_000;

const EMPTY: AddonHealth = { lastOkAt: null, lastLatencyMs: null, lastError: null, reported: null };

const RESOURCE =
  /^(.*\/)(?:manifest\.json|health|scrobble|(?:catalog|meta|stream)\/(?:audiobook|podcast|episode)\/[^/]+(?:\/[^/]*)?\.json)(?:\?.*)?$/;

/** The add-on base a request went to, or `null` for a URL that is not an add-on resource. */
export function requestAddonBase(url: string): string | null {
  return RESOURCE.exec(url)?.[1] ?? null;
}

/** Statuses that mean the add-on answered as it should; a 404 for an unknown ID is normal. */
const answered = (status: number) => status < 500 && ![401, 403, 429].includes(status);

/** Keeps the last outcome per add-on base, for Settings → Add-ons. */
export class HealthTracker {
  private readonly entries = new Map<string, AddonHealth>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  private update(base: string, change: (h: AddonHealth) => AddonHealth): void {
    this.entries.set(base, change(this.entries.get(base) ?? EMPTY));
    // A long session asks many add-ons; old ones can go.
    if (this.entries.size > 200) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Records one request's outcome; ignores URLs that are not add-on resources. */
  record(
    url: string,
    outcome:
      { ok: true; latencyMs: number } | { ok: false; message: string; status: number | null },
    at: number,
  ): void {
    const base = requestAddonBase(url);
    if (!base) return;
    this.update(base, (h) =>
      outcome.ok
        ? { ...h, lastOkAt: at, lastLatencyMs: outcome.latencyMs }
        : { ...h, lastError: { message: outcome.message, status: outcome.status, at } },
    );
  }

  report(addonUrl: string, response: HealthResponse, at: number): void {
    this.update(addonBase(addonUrl), (h) => ({
      ...h,
      reported: { status: response.status, message: response.message ?? null, at },
    }));
  }

  get(addonUrl: string): AddonHealth {
    return this.entries.get(addonBase(addonUrl)) ?? EMPTY;
  }

  /** For `useSyncExternalStore`. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;
}

/** A fetcher that tells `tracker` how each add-on request went. */
export function trackedFetcher(
  fetcher: Fetcher,
  tracker: HealthTracker,
  now: () => number = Date.now,
): Fetcher {
  return async (url, init) => {
    const started = now();
    try {
      const response = await fetcher(url, init);
      const at = now();
      tracker.record(
        url,
        answered(response.status)
          ? { ok: true, latencyMs: at - started }
          : {
              ok: false,
              message: `The add-on answered ${response.status}`,
              status: response.status,
            },
        at,
      );
      return response;
    } catch (error) {
      const message = init.signal.aborted
        ? 'The add-on took too long to answer'
        : 'The add-on could not be reached';
      tracker.record(url, { ok: false, message, status: null }, now());
      throw error;
    }
  };
}

/** Asks an add-on's `/health`; `null` when it gives no usable answer. */
export async function checkHealth(
  fetcher: Fetcher,
  addon: InstalledAddon,
  tracker: HealthTracker,
  now: () => number = Date.now,
  timeoutMs = 10_000,
): Promise<HealthResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${addonBase(addon.url)}health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const parsed = HealthResponse.safeParse(await response.json());
    if (!parsed.success) return null;
    tracker.report(addon.url, parsed.data, now());
    return parsed.data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One word for the add-on's state, newest evidence first. */
export function healthState(health: AddonHealth): HealthState {
  const { lastOkAt, lastLatencyMs, lastError, reported } = health;
  const latest = Math.max(lastOkAt ?? -1, lastError?.at ?? -1, reported?.at ?? -1);
  if (latest < 0) return 'unknown';
  if (reported?.status === 'down' && reported.at === latest) return 'failing';
  if (lastError && lastError.at === latest) return 'failing';
  if (reported?.status === 'degraded') return 'degraded';
  if (lastLatencyMs !== null && lastLatencyMs > SLOW_MS) return 'slow';
  if (lastOkAt !== null || reported?.status === 'ok') return 'ok';
  return 'unknown';
}

function queryParam(query: string, name: string): string | null {
  for (const pair of query.split('&')) {
    const at = pair.indexOf('=');
    const key = at < 0 ? pair : pair.slice(0, at);
    if (key !== name) continue;
    try {
      return decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The manifest URL in a link a configure page hands back: `lelap://addon?manifest=…`, or
 * `https://<web app>/addon?manifest=…`. `null` for anything else.
 */
export function parseAddonLink(link: string): string | null {
  const match = /^(?:lelap:\/\/|https?:\/\/[^/?#]+\/)addon\/?\?([^#]*)/i.exec(link.trim());
  if (!match) return null;
  const manifest = queryParam(match[1] ?? '', 'manifest');
  if (!manifest || /^lelap:/i.test(manifest)) return null;
  // Only real web addresses: a bare word must not turn into `https://word/manifest.json`.
  if (!/^https?:\/\//i.test(manifest)) return null;
  return normalizeManifestUrl(manifest);
}
