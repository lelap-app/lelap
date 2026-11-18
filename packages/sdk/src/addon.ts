import type { ZodType } from 'zod';

import {
  allowedReturn,
  checkFields,
  type Config,
  type ConfigField,
  configuredPage,
  configurePage,
  decodeConfig,
  encodeConfig,
  isConfigToken,
  readForm,
  returnUrl,
} from './config';
import { type Extra, parseExtra, parseRoute } from './paths';
import {
  type CatalogResponse,
  CatalogResponse as CatalogResponseSchema,
  type ContentType,
  type HealthResponse,
  HealthResponse as HealthResponseSchema,
  LATEST_PROTOCOL_VERSION,
  Manifest as ManifestSchema,
  type Manifest,
  type MetaResponse,
  MetaResponse as MetaResponseSchema,
  type ScrobbleEvent,
  ScrobbleRequest,
  type StreamResponse,
  WebStreamResponse,
  type ArtworkResponse,
  ArtworkResponse as ArtworkResponseSchema,
} from './protocol';

type Awaitable<T> = T | Promise<T>;

/** `config` is what the listener chose on the configure page, or `null` without one. */
export type CatalogArgs = {
  type: ContentType;
  id: string;
  extra: Extra;
  config: Config | null;
  request: Request;
};
export type ItemArgs = { type: ContentType; id: string; config: Config | null; request: Request };
export type ScrobbleArgs = { events: ScrobbleEvent[]; config: Config | null; request: Request };
export type HealthArgs = { config: Config | null; request: Request };

export type ConfigureOptions = {
  fields: ConfigField[];
  /**
   * Encrypts the config in the URL with AES-GCM, so only this add-on can read it. Required for
   * `password` fields. Keep it out of your repository (a Workers secret, an environment variable);
   * changing it makes every configured URL unreadable.
   */
  secret?: string;
  /**
   * Origins of web builds of the app that may receive the manifest URL at `<origin>/addon`, such
   * as `https://listen.example.org`. The Android app's `lelap://addon` is always allowed.
   */
  returnOrigins?: string[];
  /**
   * Checks a config before the URL is made, such as signing in to your service with the given
   * account. Return a message to show it on the form; return nothing to accept it.
   */
  check?: (config: Config, request: Request) => Awaitable<string | null | undefined>;
};

export type AddonHandlers = {
  manifest: Manifest;
  catalog?: (args: CatalogArgs) => Awaitable<CatalogResponse>;
  /** Return `null` when the ID is unknown; the response is then a 404. */
  meta?: (args: ItemArgs) => Awaitable<MetaResponse | null>;
  stream?: (args: ItemArgs) => Awaitable<StreamResponse>;
  /** Since revision 3: pictures for an item, such as a square cover. */
  artwork?: (args: ItemArgs) => Awaitable<ArtworkResponse>;
  /**
   * Events the app reports, oldest first. Resolve when they are handled (or deliberately
   * ignored); throw an `AddonError` with a 4xx status for events that should not be sent again.
   */
  scrobble?: (args: ScrobbleArgs) => Awaitable<void>;
  /**
   * Serves `/configure` and reads `/{token}/…` URLs, where the token carries the config. The
   * config lives in the URL the app stores, never on a server.
   */
  configure?: ConfigureOptions;
  /**
   * Answers `GET /health`; check what the add-on relies on, quickly. Without it, `/health` says
   * `ok` whenever the add-on runs.
   */
  health?: (args: HealthArgs) => Awaitable<HealthResponse>;
};

export type AddonOptions = {
  /** Path the add-on is mounted under, such as `/librivox`. Defaults to the root. */
  basePath?: string;
  /** Check handler output against the protocol schemas (slower; on by default). */
  validate?: boolean;
  /** Called with errors thrown by handlers, before the 500 response. */
  onError?: (error: unknown, request: Request) => void;
};

export type Addon = {
  manifest: Manifest;
  fetch: (request: Request) => Promise<Response>;
};

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export class AddonError extends Error {
  /** Seconds the app should wait before asking again; sent as `Retry-After`. */
  readonly retryAfter: number | undefined;
  constructor(
    readonly status: number,
    message: string,
    options: { retryAfter?: number } = {},
  ) {
    super(message);
    this.retryAfter = options.retryAfter;
  }
}

function json(body: unknown, status = 200, maxAge?: number): Response {
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (status === 200 && maxAge !== undefined)
    headers['Cache-Control'] = `public, max-age=${maxAge}`;
  return new Response(JSON.stringify(body), { status, headers });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // The page and its URLs can carry the listener's settings.
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src https:; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

function checked<T>(schema: ZodType<T>, value: T, validate: boolean): T {
  if (!validate) return value;
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(`Handler output does not match the protocol: ${result.error.message}`);
  return result.data;
}

/**
 * Turns handlers into a `fetch(request)` function that Cloudflare Workers, Deno, Bun and Node
 * (through an adapter such as `@hono/node-server`) can serve.
 */
export function createAddon(handlers: AddonHandlers, options: AddonOptions = {}): Addon {
  const declared = ManifestSchema.parse(handlers.manifest);
  const configure = handlers.configure;
  if (configure) checkFields(configure.fields, configure.secret);
  const required = configure?.fields.some((f) => f.required) ?? false;
  const served = (configured: boolean): Manifest => ({
    ...declared,
    protocolVersion: Math.max(declared.protocolVersion ?? 1, LATEST_PROTOCOL_VERSION),
    ...(configure ? { configurable: true } : {}),
    behaviorHints: {
      ...declared.behaviorHints,
      health: true,
      ...(configure ? { configurable: true, configurationRequired: required && !configured } : {}),
    },
  });
  const manifest = served(false);
  const base = (options.basePath ?? '').replace(/\/+$/, '');
  const validate = options.validate ?? true;
  const typesFor = (resource: string) => {
    const definition = manifest.resources.find(
      (r) => (typeof r === 'string' ? r : r.name) === resource,
    );
    if (!definition) return [];
    return typeof definition === 'string' ? manifest.types : (definition.types ?? manifest.types);
  };

  const handle = async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS_HEADERS });

    const { pathname } = new URL(request.url);
    if (base && pathname !== base && !pathname.startsWith(`${base}/`))
      return json({ error: 'Not found' }, 404);
    let path = pathname.slice(base.length).replace(/^\/+/, '');
    let config: Config | null = null;
    let token: string | null = null;
    const first = path.split('/')[0] ?? '';
    if (isConfigToken(first)) {
      if (!configure) return json({ error: 'Not found' }, 404);
      token = first;
      path = path.slice(first.length + 1);
      config = await decodeConfig(first, configure.secret);
      if (!config)
        return json({ error: 'These settings cannot be read. Configure the add-on again.' }, 403);
    }

    if (path === 'configure' && configure) return await serveConfigure(request, config);
    if (path === 'health') {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return json({ error: 'Method not allowed' }, 405);
      const body = handlers.health
        ? checked(HealthResponseSchema, await handlers.health({ config, request }), validate)
        : { status: 'ok' as const };
      return json(body, 200, body.cacheMaxAge ?? 0);
    }
    if (path === 'manifest.json' && (request.method === 'GET' || request.method === 'HEAD'))
      return json(token ? served(true) : manifest, 200, 3600);
    if (required && !config) return json({ error: 'Configure this add-on first' }, 403);

    if (path === 'scrobble') {
      if (!handlers.scrobble || !typesFor('scrobble').length)
        return json({ error: 'Not found' }, 404);
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'The body is not JSON' }, 400);
      }
      const parsed = ScrobbleRequest.safeParse(body);
      if (!parsed.success) return json({ error: 'These are not scrobble events' }, 400);
      await handlers.scrobble({ events: parsed.data.events, config, request });
      return json({ received: parsed.data.events.length });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return json({ error: 'Method not allowed' }, 405);
    const route = parseRoute(path);
    if (!route) return json({ error: 'Not found' }, 404);

    if (route.resource === 'manifest') return json({ error: 'Not found' }, 404);
    if (!typesFor(route.resource).includes(route.type)) return json({ error: 'Not found' }, 404);

    switch (route.resource) {
      case 'catalog': {
        if (!handlers.catalog) break;
        const known = manifest.catalogs.some((c) => c.type === route.type && c.id === route.id);
        if (!known) return json({ error: 'Unknown catalog' }, 404);
        const body = checked(
          CatalogResponseSchema,
          await handlers.catalog({ ...route, config, request }),
          validate,
        );
        return json(body, 200, body.cacheMaxAge);
      }
      case 'meta': {
        if (!handlers.meta) break;
        const result = await handlers.meta({ ...route, config, request });
        if (!result) return json({ error: 'Not found' }, 404);
        const body = checked(MetaResponseSchema, result, validate);
        return json(body, 200, body.cacheMaxAge);
      }
      case 'artwork': {
        if (!handlers.artwork) break;
        const body = checked(
          ArtworkResponseSchema,
          await handlers.artwork({ ...route, config, request }),
          validate,
        );
        return json(body, 200, body.cacheMaxAge);
      }
      case 'stream': {
        if (!handlers.stream) break;
        // A web add-on's answer passes through the network, so it never carries headers.
        const body = checked(
          WebStreamResponse as ZodType<StreamResponse>,
          await handlers.stream({ ...route, config, request }),
          validate,
        );
        // Also with validation off: a login in a header must not leave as JSON.
        if (body.streams.some((s) => s.headers !== undefined))
          throw new Error('Only add-ons inside the app may send stream headers.');
        return json(body, 200, body.cacheMaxAge);
      }
    }
    return json({ error: 'Not found' }, 404);
  };

  async function serveConfigure(request: Request, previous: Config | null): Promise<Response> {
    if (!configure) return json({ error: 'Not found' }, 404);
    const url = new URL(request.url);
    const allowed = (target: string | null | undefined) =>
      target && allowedReturn(target, configure.returnOrigins) ? target : undefined;
    const page = {
      name: declared.name,
      description: declared.description,
      fields: configure.fields,
      host: url.host,
    };
    if (request.method === 'GET' || request.method === 'HEAD') {
      const returnTo = allowed(url.searchParams.get('return'));
      return html(
        configurePage({
          ...page,
          ...(previous ? { values: previous } : {}),
          ...(returnTo ? { returnTo } : {}),
        }),
      );
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    // The form posts as `application/x-www-form-urlencoded`, which reads like catalog extras.
    let values: Extra;
    try {
      values = parseExtra(await request.text());
    } catch {
      return html(configurePage({ ...page, error: 'The form could not be read.' }), 400);
    }
    const form = { get: (name: string): string | null => values[name] ?? null };
    const raw = form.get('return');
    const returnTo = allowed(typeof raw === 'string' ? raw : null);
    const keep = new Set(configure.fields.filter((f) => f.type === 'password').map((f) => f.key));
    // An empty password field keeps the one already in the URL, so changing a setting does not
    // mean typing the password again.
    const read = readForm(configure.fields, {
      get: (name) => {
        const value = form.get(name);
        if (keep.has(name) && (value === null || value === '') && previous) return previous[name];
        return value;
      },
    });
    const again = (error: string, values: Config) =>
      html(configurePage({ ...page, values, error, ...(returnTo ? { returnTo } : {}) }), 400);
    if ('error' in read) return again(read.error, previous ?? {});
    const problem = await configure.check?.(read.config, request);
    if (problem) return again(problem, read.config);
    const newToken = await encodeConfig(read.config, configure.secret);
    const manifestUrl = `${url.origin}${base}/${newToken}/manifest.json`;
    if (returnTo)
      return new Response(null, {
        status: 303,
        headers: { Location: returnUrl(returnTo, manifestUrl), 'Referrer-Policy': 'no-referrer' },
      });
    return html(configuredPage({ name: declared.name, manifestUrl, host: url.host }));
  }

  return {
    manifest,
    fetch: async (request) => {
      try {
        return await handle(request);
      } catch (error) {
        if (error instanceof AddonError) {
          const response = json({ error: error.message }, error.status);
          if (error.retryAfter !== undefined && error.retryAfter >= 0)
            response.headers.set('Retry-After', String(Math.round(error.retryAfter)));
          return response;
        }
        options.onError?.(error, request);
        return json({ error: 'The add-on failed to answer' }, 500);
      }
    },
  };
}
