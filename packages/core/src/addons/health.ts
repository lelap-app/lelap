import { HEALTH_STATUSES, HealthResponse, type HealthStatus } from '@lelap/sdk';

import { addonBase, type Fetcher, type InstalledAddon, normalizeManifestUrl } from './client';
import { addonBlock, protocolHeaders } from './revision';
import type { Poster } from '../scrobble';

/** What the app saw of one add-on, kept on this device across starts (M159). Never sent anywhere. */
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
  /^(.*\/)(?:manifest\.json|health|scrobble|(?:catalog|meta|stream|artwork|series)\/(?:audiobook|podcast|episode)\/[^/]+(?:\/[^/]*)?\.json)(?:\?.*)?$/;

/** The add-on base a request went to, or `null` for a URL that is not an add-on resource. */
export function requestAddonBase(url: string): string | null {
  return RESOURCE.exec(url)?.[1] ?? null;
}

/** Statuses that mean the add-on answered as it should; a 404 for an unknown ID is normal. */
const answered = (status: number) => status < 500 && ![401, 403, 429].includes(status);

/** Where kept health is read from and written to, such as a device value. */
export type HealthStorage = {
  read(): Record<string, AddonHealth>;
  write(all: Record<string, AddonHealth>): void;
};

/** Add-ons whose health is kept at once; a long life meets many, and old ones can go. */
export const MAX_HEALTH_ENTRIES = 200;

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function readHealth(value: unknown): AddonHealth | null {
  const h = asRecord(value);
  if (!h) return null;
  const error = asRecord(h.lastError);
  const reported = asRecord(h.reported);
  return {
    lastOkAt: isNumber(h.lastOkAt) ? h.lastOkAt : null,
    lastLatencyMs: isNumber(h.lastLatencyMs) ? h.lastLatencyMs : null,
    lastError:
      error && isText(error.message) && isNumber(error.at)
        ? {
            message: error.message,
            status: isNumber(error.status) ? error.status : null,
            at: error.at,
          }
        : null,
    reported:
      reported &&
      (HEALTH_STATUSES as readonly unknown[]).includes(reported.status) &&
      isNumber(reported.at)
        ? {
            status: reported.status as HealthStatus,
            message: isText(reported.message) ? reported.message : null,
            at: reported.at,
          }
        : null,
  };
}

/** Reads kept health from JSON, by add-on base, dropping anything that isn't one. */
export function parseHealth(text: string | null): Record<string, AddonHealth> {
  if (!text) return {};
  try {
    const all = asRecord(JSON.parse(text));
    if (!all) return {};
    return Object.fromEntries(
      Object.entries(all).flatMap(([base, value]) => {
        const health = readHealth(value);
        return health ? [[base, health]] : [];
      }),
    );
  } catch {
    return {};
  }
}

/** Keeps the last outcome per add-on base, for Settings → Add-ons. */
export class HealthTracker {
  private readonly entries = new Map<string, AddonHealth>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private storage: HealthStorage | null = null;
  private loaded = false;

  /** `onFailure` hears each failed request, for the diagnostics log. */
  constructor(
    private readonly onFailure?: (
      base: string,
      url: string,
      failure: { message: string; status: number | null },
    ) => void,
  ) {}

  /**
   * Keeps health in `storage` from now on, so the next start shows what this one saw. Read on
   * first use, not here: the app attaches while its database may still be opening.
   */
  attach(storage: HealthStorage): void {
    this.storage = storage;
    this.loaded = false;
  }

  private load(): void {
    if (this.loaded || !this.storage) return;
    let kept: Record<string, AddonHealth>;
    try {
      kept = this.storage.read();
    } catch {
      return;
    }
    this.loaded = true;
    // What this run saw before the store could be read is newer, so it stays on top.
    const seen = new Map(this.entries);
    this.entries.clear();
    for (const [base, health] of Object.entries(kept)) {
      if (!seen.has(base)) this.entries.set(base, health);
    }
    for (const [base, health] of seen) this.entries.set(base, health);
    this.trim();
  }

  private trim(): void {
    while (this.entries.size > MAX_HEALTH_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  private update(base: string, change: (h: AddonHealth) => AddonHealth): void {
    this.load();
    const next = change(this.entries.get(base) ?? EMPTY);
    // The newest last, so the add-ons not heard from longest go first.
    this.entries.delete(base);
    this.entries.set(base, next);
    this.trim();
    try {
      // Not before the kept health is read: this run's few entries would replace it all.
      if (this.loaded) this.storage?.write(Object.fromEntries(this.entries));
    } catch {
      // Kept in memory for this run.
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
    if (!outcome.ok) this.onFailure?.(base, url, outcome);
  }

  report(addonUrl: string, response: HealthResponse, at: number): void {
    this.update(addonBase(addonUrl), (h) => ({
      ...h,
      reported: { status: response.status, message: response.message ?? null, at },
    }));
  }

  get(addonUrl: string): AddonHealth {
    this.load();
    return this.entries.get(addonBase(addonUrl)) ?? EMPTY;
  }

  /** For `useSyncExternalStore`. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;
}

/** Wraps a request so `tracker` hears how it went. */
function tracked<I extends { signal: AbortSignal }, R extends { status: number }>(
  request: (url: string, init: I) => Promise<R>,
  tracker: HealthTracker,
  now: () => number,
): (url: string, init: I) => Promise<R> {
  return async (url, init) => {
    const started = now();
    try {
      const response = await request(url, init);
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

/** A fetcher that tells `tracker` how each add-on request went. */
export function trackedFetcher(
  fetcher: Fetcher,
  tracker: HealthTracker,
  now: () => number = Date.now,
): Fetcher {
  return tracked(fetcher, tracker, now);
}

/** A scrobble poster that tells `tracker` how each post went (M159). */
export function trackedPoster(
  post: Poster,
  tracker: HealthTracker,
  now: () => number = Date.now,
): Poster {
  return tracked(post, tracker, now);
}

/** Asks an add-on's `/health`; `null` when it gives no usable answer. */
export async function checkHealth(
  fetcher: Fetcher,
  addon: InstalledAddon,
  tracker: HealthTracker,
  now: () => number = Date.now,
  timeoutMs = 10_000,
): Promise<HealthResponse | null> {
  // An add-on that won't work with this app is asked nothing, `/health` included (M156).
  if (addonBlock(addon)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${addonBase(addon.url)}health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', ...protocolHeaders(addon.manifest) },
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
