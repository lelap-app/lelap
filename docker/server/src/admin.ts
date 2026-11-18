import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { secret } from './secrets';

declare const __LELAP_VERSION__: string | undefined;

/** The release the image was built from (`apps/app/app.json`), set by `build.mjs`. */
export const version = typeof __LELAP_VERSION__ === 'string' ? __LELAP_VERSION__ : 'dev';

export type Check = { name: string; ok: boolean; detail: string };
export type Table = {
  title: string;
  note?: string | undefined;
  columns: string[];
  rows: (string | number)[][];
};
/** What a service reports about itself. Counts and settings only, never what listeners store. */
export type Status = {
  checks: Check[];
  settings?: [string, string][];
  tables?: Table[];
};

export type Report = Status & {
  service: string;
  version: string;
  healthy: boolean;
  node: string;
  startedAt: string;
  uptimeSeconds: number;
  memoryBytes: number;
};

export type AdminOptions = {
  service: string;
  /** Unset or shorter than 16 characters: everything but `/health` is off. */
  token: string | undefined;
  /** Answer requests from public addresses too. Off by default. */
  allowRemote?: boolean;
  /** Quick checks for `/health`, which anyone local may call: no heavy queries here. */
  health: () => Promise<Check[]>;
  /** The rest of the page, only for callers with the token. */
  status: () => Promise<Status>;
  now?: () => number;
  /** Wait before answering a wrong token, so guessing a short one takes long. */
  failDelayMs?: number;
  /** Host names the page answers besides IP addresses and `localhost` (`ADMIN_HOSTS`). */
  hosts?: string[];
};

export type AdminRequest = {
  method: string;
  path: string;
  authorization: string | null;
  /** The `Host` header. */
  host: string | null;
};

/** Wrong tokens from one address before it is refused for the rest of the window. */
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 15 * 60_000;
// Bounds the memory a flood of addresses can take; past it, expired entries are dropped.
const MAX_TRACKED = 10_000;

export const MIN_TOKEN = 16;
const started = Date.now();

const digest = (text: string) => createHash('sha256').update(text).digest();

/** The token from `Authorization: Bearer …` or from Basic auth's password (any user name). */
function presented(header: string | null): string | null {
  const match = /^(\S+)\s+(.*)$/.exec(header?.trim() ?? '');
  if (!match) return null;
  const [, scheme = '', value = ''] = match;
  if (scheme.toLowerCase() === 'bearer') return value.trim();
  if (scheme.toLowerCase() !== 'basic') return null;
  const decoded = Buffer.from(value.trim(), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon === -1 ? null : decoded.slice(colon + 1);
}

// Loopback, private networks (where the Docker host and its containers are), link-local and
// CGNAT (Tailscale and the like). Not the proxy's wider blocklist: NAT64 would let the internet in.
const local = new BlockList();
for (const [net, prefix] of [
  ['127.0.0.0', 8],
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['169.254.0.0', 16],
  ['100.64.0.0', 10],
] as const) {
  local.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  local.addSubnet(net, prefix, 'ipv6');
}

/**
 * Whether a `Host` header names the page by address, `localhost` or a listed name. A DNS
 * rebinding page reaches the port under its own name, so refusing other names keeps it out.
 */
export function isAllowedHost(host: string | null, names: readonly string[] = []): boolean {
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === 'localhost' || isIP(hostname.replace(/^\[|\]$/g, '')) !== 0) return true;
  return names.some((name) => {
    try {
      return new URL(`http://${name.trim()}`).hostname.toLowerCase() === hostname;
    } catch {
      return false;
    }
  });
}

/** Whether a caller's address is the server itself or on a private network. */
export function isLocalAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return local.check(address, 'ipv4');
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  return mapped ? local.check(mapped, 'ipv4') : local.check(address, 'ipv6');
}

const headers = (type: string): Record<string, string> => ({
  'Content-Type': type,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  // No scripts, no requests anywhere: the page is one HTML document with its own styles.
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
});

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...headers('application/json'), ...extra },
  });

const failing = (name: string, error: unknown): Check => ({
  name,
  ok: false,
  detail: error instanceof Error ? error.message : String(error),
});

/**
 * The admin page's routes, on a port of its own: `/health` for Docker's health check, `/` (HTML)
 * and `/status.json` behind the token. `remote` is the caller's address.
 */
export function adminHandler(options: AdminOptions) {
  const { service, allowRemote = false, now = Date.now, failDelayMs = 500, hosts = [] } = options;
  const token = options.token && options.token.length >= MIN_TOKEN ? options.token : undefined;
  const expected = token ? digest(token) : null;

  const authorized = (header: string | null) => {
    const given = presented(header);
    // Compared as SHA-256 digests, so the comparison takes the same time for any length.
    return expected !== null && given !== null && timingSafeEqual(digest(given), expected);
  };

  // Wrong tokens per caller address: how many, and when the first of this window came.
  const failures = new Map<string, { count: number; since: number }>();
  const lockedOut = (remote: string) => {
    const entry = failures.get(remote);
    if (entry && now() - entry.since >= FAILURE_WINDOW_MS) failures.delete(remote);
    return (failures.get(remote)?.count ?? 0) >= MAX_FAILURES;
  };
  const failed = (remote: string) => {
    if (failures.size >= MAX_TRACKED) {
      for (const [key, entry] of failures) {
        if (now() - entry.since >= FAILURE_WINDOW_MS) failures.delete(key);
      }
      // Still full: the oldest go first (a Map keeps insertion order), never every counter.
      for (const key of failures.keys()) {
        if (failures.size < MAX_TRACKED) break;
        failures.delete(key);
      }
    }
    const entry = failures.get(remote) ?? { count: 0, since: now() };
    failures.set(remote, { ...entry, count: entry.count + 1 });
  };

  const health = () => options.health().catch((error: unknown) => [failing('Health', error)]);

  const report = async (): Promise<Report> => {
    const [quick, status] = await Promise.all([
      health(),
      options.status().catch((error: unknown) => ({ checks: [failing(service, error)] })),
    ]);
    const checks = [...quick, ...status.checks];
    return {
      service,
      version,
      healthy: checks.every((c) => c.ok),
      node: process.version,
      startedAt: new Date(started).toISOString(),
      uptimeSeconds: Math.round((now() - started) / 1000),
      memoryBytes: process.memoryUsage().rss,
      ...status,
      checks,
    };
  };

  return async (request: AdminRequest, remote: string): Promise<Response> => {
    if (!allowRemote && !isLocalAddress(remote)) {
      return json({ error: 'The admin page only answers local addresses.' }, 403);
    }
    if (!isAllowedHost(request.host, hosts)) {
      return json(
        { error: 'Open the admin page by address, or list its name in ADMIN_HOSTS.' },
        421,
      );
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Only GET.' }, 405, { Allow: 'GET, HEAD' });
    }
    if (request.path === '/health') {
      // Only ok or not: the details are behind the token.
      const healthy = (await health()).every((c) => c.ok);
      return json({ status: healthy ? 'ok' : 'error' }, healthy ? 200 : 503);
    }
    if (request.path !== '/' && request.path !== '/status.json') {
      return json({ error: 'Not found.' }, 404);
    }
    if (!token) {
      return json(
        { error: 'The admin page is off. Set ADMIN_TOKEN (16 characters or more).' },
        404,
      );
    }
    if (lockedOut(remote)) {
      return json({ error: 'Too many wrong tokens. Try again in 15 minutes.' }, 429, {
        'Retry-After': String(Math.ceil(FAILURE_WINDOW_MS / 1000)),
      });
    }
    if (!authorized(request.authorization)) {
      if (request.authorization) {
        failed(remote);
        await sleep(failDelayMs);
      }
      return json({ error: 'Wrong or missing token.' }, 401, {
        'WWW-Authenticate': `Basic realm="Lelap ${service}", charset="UTF-8"`,
      });
    }
    const body = await report();
    if (request.path === '/status.json') return json(body);
    return new Response(page(body), { headers: headers('text/html; charset=utf-8') });
  };
}

/** Starts the admin page on its own port, next to the service's. */
export function serveAdmin(options: AdminOptions & { port: number }): void {
  const handle = adminHandler(options);
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const response = await handle(
          {
            method: req.method ?? 'GET',
            path: new URL(req.url ?? '/', 'http://admin').pathname,
            authorization: req.headers.authorization ?? null,
            host: req.headers.host ?? null,
          },
          req.socket.remoteAddress ?? '',
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
      } catch {
        if (!res.headersSent) res.writeHead(500, headers('application/json'));
        res.end('{"error":"Server error."}');
      }
    })();
  });
  // A taken port must not take the service down with it.
  server.on('error', (error) => console.error(`${options.service} admin page: ${error.message}`));
  server.listen(options.port, () => {
    const state = !options.token
      ? 'off (no ADMIN_TOKEN)'
      : options.token.length < MIN_TOKEN
        ? `off (ADMIN_TOKEN shorter than ${MIN_TOKEN} characters)`
        : 'on';
    console.log(`${options.service} admin page on :${options.port}, ${state}`);
  });
}

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function duration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0
    ? `${days} d ${hours} h`
    : hours > 0
      ? `${hours} h ${minutes} min`
      : `${minutes} min`;
}

function page(r: Report): string {
  const rows = (pairs: [string, string][]) =>
    pairs.map(([k, v]) => `<tr><th>${escape(k)}</th><td>${escape(v)}</td></tr>`).join('');
  const checks = r.checks
    .map(
      (c) =>
        `<tr><th>${escape(c.name)}</th><td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? 'OK' : 'Failing'}</td><td>${escape(c.detail)}</td></tr>`,
    )
    .join('');
  const tables = (r.tables ?? [])
    .map(
      (t) => `<h2>${escape(t.title)}</h2>${t.note ? `<p>${escape(t.note)}</p>` : ''}
<table><thead><tr>${t.columns.map((c) => `<th>${escape(c)}</th>`).join('')}</tr></thead>
<tbody>${t.rows.map((row) => `<tr>${row.map((v) => `<td>${escape(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Lelap ${escape(r.service)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:56rem;padding:0 1rem;color:#1d1b16;background:#faf8f3}
h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}
table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{text-align:left;padding:.3rem .6rem;border-bottom:1px solid #ddd6c8;vertical-align:top}
th{font-weight:600}.ok{color:#2f6b2f}.bad{color:#a32b1f;font-weight:600}p{color:#5d574b}
@media (prefers-color-scheme:dark){body{color:#ece7dc;background:#1b1a17}th,td{border-color:#3a372f}.ok{color:#8fcf8f}.bad{color:#ff8a7a}p{color:#aaa395}}
</style></head><body>
<h1>Lelap ${escape(r.service)}: <span class="${r.healthy ? 'ok' : 'bad'}">${r.healthy ? 'healthy' : 'not healthy'}</span></h1>
<table>${rows([
    ['Version', r.version],
    ['Node', r.node],
    ['Running for', duration(r.uptimeSeconds)],
    ['Memory', formatBytes(r.memoryBytes)],
  ])}</table>
<h2>Health</h2><table>${checks}</table>
${r.settings?.length ? `<h2>At a glance</h2><table>${rows(r.settings)}</table>` : ''}
${tables}
</body></html>`;
}

/** Whether the service answers on its own port, as a reverse proxy would reach it. */
export async function answers(servicePort: number, timeoutMs = 3000): Promise<Check> {
  const name = `Port ${servicePort}`;
  try {
    const response = await fetch(`http://127.0.0.1:${servicePort}/`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return { name, ok: response.status < 500, detail: `Answers with ${response.status}` };
  } catch (error) {
    return failing(name, error);
  }
}

/**
 * Starts the admin page when `ADMIN_PORT` is set, with the token from `secret()`. Its health is
 * whether `servicePort` answers, plus the service's own quick `health`.
 */
export function adminFromEnv(
  service: string,
  servicePort: number,
  parts: { health?: () => Promise<Check[]>; status: () => Promise<Status> },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!env.ADMIN_PORT) return;
  const port = Number(env.ADMIN_PORT);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`ADMIN_PORT is not a port: ${port}`);
  serveAdmin({
    service,
    port,
    token: secret('ADMIN_TOKEN', env),
    allowRemote: env.ADMIN_ALLOW_REMOTE === 'true',
    hosts: (env.ADMIN_HOSTS ?? '').split(',').filter((name) => name.trim()),
    health: async () => {
      const [own, rest] = await Promise.all([answers(servicePort), parts.health?.() ?? []]);
      return [own, ...rest];
    },
    status: parts.status,
  });
}
