import type { ZodType } from 'zod';

import {
  allowedReturn,
  checkFields,
  type Config,
  type ConfigField,
  type ConfigureText,
  configuredPage,
  configurePage,
  decodeConfig,
  encodeConfig,
  isConfigToken,
  readForm,
  returnUrl,
} from './config';
import { type Extra, parseRoute } from './paths';
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
  type SeriesResponse,
  SeriesResponse as SeriesResponseSchema,
} from './protocol';

type Awaitable<T> = T | Promise<T>;

/** What Cloudflare Workers hands `fetch` as its third argument; only `waitUntil` is used. */
export type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

/**
 * Every handler gets these. `waitUntil` keeps work going after the answer is sent, such as
 * finishing a slow search into a cache: on Workers through the execution context, elsewhere the
 * promise simply runs. A rejection goes to `onError`.
 */
export type HandlerArgs = {
  config: Config | null;
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
};

/** `config` is what the listener chose on the configure page, or `null` without one. */
export type CatalogArgs = HandlerArgs & { type: ContentType; id: string; extra: Extra };
export type ItemArgs = HandlerArgs & { type: ContentType; id: string };
export type ScrobbleArgs = HandlerArgs & { events: ScrobbleEvent[] };
export type HealthArgs = HandlerArgs;
/** `name` is the series' name; `extra` has `author`, `language` and `work` when the app knows them. */
export type SeriesArgs = HandlerArgs & { type: ContentType; name: string; extra: Extra };

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
  /** What the form says above its fields: an intro, a link, steps and a note. */
  text?: ConfigureText;
  /**
   * A second page once the first is accepted, with fields that depend on it, such as the lists in
   * the listener's account. The first page's settings ride along sealed for an hour, never shown.
   */
  choose?: {
    intro: string;
    /** The fields, for the settings so far; a reconfigure starts from the link's own choices. */
    fields: (config: Config, request: Request) => Awaitable<ConfigField[]>;
    /**
     * The settings with the choices in them, or a message to show on the page, which keeps the
     * ticks and what was typed. Without it, the choices are added as they are.
     */
    apply?: (config: Config, chosen: Config, request: Request) => Awaitable<Config | string>;
  };
  /** The manifest for one listener's settings, such as catalogs that depend on them. */
  manifest?: (config: Config) => Manifest;
  /**
   * Opens add-on addresses made before the add-on used this configure, so they keep working:
   * a path segment starting with `prefix` (such as `v1.`) is handed to `open`, and its config is
   * used as if it came from a token. Configuring again hands out a new token.
   */
  legacy?: { prefix: string; open: (segment: string) => Awaitable<Config | null> };
};

/** Longer tokens are refused, so an add-on address stays usable as a URL. */
export const MAX_CONFIG_TOKEN = 4096;
/** How long the second page keeps the first page's settings. */
export const CHOOSE_DRAFT_MS = 60 * 60 * 1000;

export type AddonHandlers = {
  manifest: Manifest;
  catalog?: (args: CatalogArgs) => Awaitable<CatalogResponse>;
  /** Return `null` when the ID is unknown; the response is then a 404. */
  meta?: (args: ItemArgs) => Awaitable<MetaResponse | null>;
  stream?: (args: ItemArgs) => Awaitable<StreamResponse>;
  /** Since revision 3: pictures for an item, such as a square cover. */
  artwork?: (args: ItemArgs) => Awaitable<ArtworkResponse>;
  /** Since revision 11: every book of a series; `{ series: null }` when it is unknown. */
  series?: (args: SeriesArgs) => Awaitable<SeriesResponse>;
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
  /** The clock, for tests; the second configure page runs out an hour after the first. */
  now?: () => number;
};

export type Addon = {
  manifest: Manifest;
  /** `env` is ignored; `ctx` is the Workers execution context, so `waitUntil` reaches it. */
  fetch: (request: Request, env?: unknown, ctx?: ExecutionContextLike) => Promise<Response>;
};

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  // Not safelisted, so a web app couldn't read how long to wait without it.
  'Access-Control-Expose-Headers': 'Retry-After',
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

function html(body: string, status = 200, nonce?: string): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // The page and its URLs can carry the listener's settings.
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src https:; frame-ancestors 'none'; base-uri 'none'${
        nonce ? `; script-src 'nonce-${nonce}'` : ''
      }`,
    },
  });
}

function newNonce(): string {
  const bytes = (
    globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  const served = (config: Config | null, from: Manifest = declared): Manifest => ({
    ...from,
    protocolVersion: Math.max(from.protocolVersion ?? 1, LATEST_PROTOCOL_VERSION),
    ...(configure ? { configurable: true } : {}),
    behaviorHints: {
      ...from.behaviorHints,
      health: true,
      ...(configure
        ? { configurable: true, configurationRequired: required && config === null }
        : {}),
    },
  });
  const manifest = served(null);
  // One listener's manifest, checked like the declared one; built once per request at most.
  const manifestFor = (config: Config | null): Manifest =>
    config && configure?.manifest
      ? served(config, ManifestSchema.parse(configure.manifest(config)))
      : config
        ? served(config)
        : manifest;
  const now = options.now ?? Date.now;
  const base = (options.basePath ?? '').replace(/\/+$/, '');
  const validate = options.validate ?? true;
  const typesFor = (resource: string) => {
    const definition = manifest.resources.find(
      (r) => (typeof r === 'string' ? r : r.name) === resource,
    );
    if (!definition) return [];
    return typeof definition === 'string' ? manifest.types : (definition.types ?? manifest.types);
  };

  const handle = async (
    request: Request,
    ctx: ExecutionContextLike | undefined,
  ): Promise<Response> => {
    const waitUntil = (promise: Promise<unknown>) => {
      const watched = Promise.resolve(promise).catch((error: unknown) =>
        options.onError?.(error, request),
      );
      ctx?.waitUntil(watched);
    };
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS_HEADERS });

    const { pathname } = new URL(request.url);
    if (base && pathname !== base && !pathname.startsWith(`${base}/`))
      return json({ error: 'Not found' }, 404);
    let path = pathname.slice(base.length).replace(/^\/+/, '');
    let config: Config | null = null;
    let token: string | null = null;
    const first = path.split('/')[0] ?? '';
    const legacy = configure?.legacy;
    const isLegacy = legacy !== undefined && first.length > 0 && first.startsWith(legacy.prefix);
    if (isConfigToken(first) || isLegacy) {
      if (!configure) return json({ error: 'Not found' }, 404);
      token = first;
      path = path.slice(first.length + 1);
      config = isLegacy
        ? await legacy.open(first)
        : await decodeConfig(first, configure.secret, declared.id);
      if (!config)
        return json({ error: 'These settings cannot be read. Configure the add-on again.' }, 403);
    }
    const current = token ? manifestFor(config) : manifest;

    if (path === 'configure' && configure) return await serveConfigure(request, config);
    if (path === 'health') {
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return json({ error: 'Method not allowed' }, 405);
      const body = handlers.health
        ? checked(
            HealthResponseSchema,
            await handlers.health({ config, request, waitUntil }),
            validate,
          )
        : { status: 'ok' as const };
      return json(body, 200, body.cacheMaxAge ?? 0);
    }
    if (path === 'manifest.json' && (request.method === 'GET' || request.method === 'HEAD'))
      return json(current, 200, 3600);
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
      await handlers.scrobble({ events: parsed.data.events, config, request, waitUntil });
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
        const known = current.catalogs.some((c) => c.type === route.type && c.id === route.id);
        if (!known) return json({ error: 'Unknown catalog' }, 404);
        const body = checked(
          CatalogResponseSchema,
          await handlers.catalog({ ...route, config, request, waitUntil }),
          validate,
        );
        return json(body, 200, body.cacheMaxAge);
      }
      case 'meta': {
        if (!handlers.meta) break;
        const result = await handlers.meta({ ...route, config, request, waitUntil });
        if (!result) return json({ error: 'Not found' }, 404);
        const body = checked(MetaResponseSchema, result, validate);
        return json(body, 200, body.cacheMaxAge);
      }
      case 'artwork': {
        if (!handlers.artwork) break;
        const body = checked(
          ArtworkResponseSchema,
          await handlers.artwork({ ...route, config, request, waitUntil }),
          validate,
        );
        return json(body, 200, body.cacheMaxAge);
      }
      case 'series': {
        if (!handlers.series) break;
        const body = checked(
          SeriesResponseSchema,
          await handlers.series({
            type: route.type,
            name: route.id,
            extra: route.extra,
            config,
            request,
            waitUntil,
          }),
          validate,
        );
        return json(body, 200, body.cacheMaxAge);
      }
      case 'stream': {
        if (!handlers.stream) break;
        // A web add-on's answer passes through the network, so it never carries headers.
        const body = checked(
          WebStreamResponse as ZodType<StreamResponse>,
          await handlers.stream({ ...route, config, request, waitUntil }),
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
    const choose = configure.choose;
    const page = {
      name: declared.name,
      description: declared.description,
      fields: configure.fields,
      host: url.host,
      ...(configure.text ? { text: configure.text } : {}),
      ...(choose ? { submit: 'Next' } : {}),
      footnote: configure.secret
        ? 'What you enter is sealed into the add-on’s address with a key only this add-on has. It is not stored on a server.'
        : 'What you enter is kept in the add-on’s address, not on a server.',
    };
    const withReturn = (returnTo: string | undefined) => (returnTo ? { returnTo } : {});
    if (request.method === 'GET' || request.method === 'HEAD') {
      const returnTo = allowed(url.searchParams.get('return'));
      // Changing a link's choices needs no token typed again.
      if (previous && choose && url.searchParams.get('start') === null) {
        try {
          return await choosePage(request, previous, page, returnTo, true);
        } catch (error) {
          if (!(error instanceof AddonError)) options.onError?.(error, request);
          const message =
            error instanceof AddonError ? error.message : 'Try again in a moment, or start here.';
          return html(
            configurePage({ ...page, values: previous, error: message, ...withReturn(returnTo) }),
          );
        }
      }
      return html(
        configurePage({
          ...page,
          ...(previous ? { values: previous } : {}),
          ...withReturn(returnTo),
        }),
      );
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const form = new URLSearchParams(await request.text());
    const returnTo = allowed(form.get('return'));
    // A problem the add-on could not put in words (its service is down) is logged, not shown.
    const failed = (error: unknown) => {
      if (error instanceof AddonError) return error.message;
      options.onError?.(error, request);
      return 'The add-on could not check these settings. Try again in a moment.';
    };
    const finish = async (config: Config): Promise<Response | string> => {
      const newToken = await encodeConfig(config, configure.secret, declared.id);
      if (newToken.length > MAX_CONFIG_TOKEN)
        return 'That is too much for one address. Choose fewer.';
      const manifestUrl = `${url.origin}${base}/${newToken}/manifest.json`;
      if (returnTo)
        return new Response(null, {
          status: 303,
          headers: { Location: returnUrl(returnTo, manifestUrl), 'Referrer-Policy': 'no-referrer' },
        });
      const nonce = newNonce();
      return html(
        configuredPage({ name: declared.name, manifestUrl, host: url.host, nonce }),
        200,
        nonce,
      );
    };

    const draft = form.get('draft');
    if (draft !== null && choose) {
      const opened = await decodeConfig(draft, configure.secret, `${declared.id}\ndraft`);
      const until = Number(opened?.['~until']);
      if (!opened || !Number.isFinite(until) || until < now())
        return html(
          configurePage({
            ...page,
            error: 'These settings ran out. Start again.',
            ...withReturn(returnTo),
          }),
          400,
        );
      const config: Config = { ...opened };
      delete config['~until'];
      let fields: ConfigField[] = [];
      let error: string;
      try {
        fields = await choose.fields(config, request);
        const read = readForm(fields, form);
        if ('error' in read) error = read.error;
        else {
          const applied = choose.apply
            ? await choose.apply(config, read.config, request)
            : { ...config, ...read.config };
          if (typeof applied === 'string') error = applied;
          else {
            const done = await finish(applied);
            if (typeof done !== 'string') return done;
            error = done;
          }
        }
      } catch (problem) {
        error = failed(problem);
      }
      // Ticks and typed values stay as sent, never the defaults again.
      const sent: Config = Object.fromEntries(
        fields.map((f) => [
          f.key,
          f.type === 'choices' ? form.getAll(f.key) : (form.get(f.key) ?? ''),
        ]),
      );
      if (fields.length === 0)
        return html(configurePage({ ...page, error, ...withReturn(returnTo) }), 400);
      return html(
        configurePage({
          ...page,
          text: { intro: choose.intro },
          fields,
          values: sent,
          error,
          submit: 'Save',
          hidden: { draft },
          ...withReturn(returnTo),
        }),
        400,
      );
    }

    const keep = new Set(configure.fields.filter((f) => f.type === 'password').map((f) => f.key));
    // An empty password field keeps the one already in the URL, so changing a setting does not
    // mean typing the password again.
    const read = readForm(configure.fields, {
      get: (name) => {
        const value = form.get(name);
        if (keep.has(name) && (value === null || value === '') && previous) return previous[name];
        return value;
      },
      getAll: (name) => form.getAll(name),
    });
    const again = (error: string, values: Config) =>
      html(configurePage({ ...page, values, error, ...withReturn(returnTo) }), 400);
    if ('error' in read) return again(read.error, previous ?? {});
    // The link's other settings, such as earlier choices, stay as they were.
    const config: Config = { ...(previous ?? {}), ...read.config };
    let problem: string | null | undefined;
    try {
      problem = await configure.check?.(config, request);
    } catch (error) {
      problem = failed(error);
    }
    if (problem) return again(problem, read.config);
    if (!choose) {
      const done = await finish(config);
      return typeof done === 'string' ? again(done, read.config) : done;
    }
    try {
      return await choosePage(request, config, page, returnTo, false);
    } catch (error) {
      return again(failed(error), read.config);
    }
  }

  /**
   * The second configure page for `config`, which rides along sealed with an expiry. From a
   * configured link it opens first, with a way back to the first page.
   */
  async function choosePage(
    request: Request,
    config: Config,
    page: Parameters<typeof configurePage>[0],
    returnTo: string | undefined,
    fromLink: boolean,
  ): Promise<Response> {
    const choose = configure?.choose;
    if (!configure || !choose) throw new Error('No second page');
    const fields = await choose.fields(config, request);
    const sealed = await encodeConfig(
      { ...config, '~until': String(now() + CHOOSE_DRAFT_MS) },
      configure.secret,
      `${declared.id}\ndraft`,
    );
    const start = `configure?start=1${returnTo ? `&return=${encodeURIComponent(returnTo)}` : ''}`;
    return html(
      configurePage({
        ...page,
        text: { intro: choose.intro },
        fields,
        values: config,
        submit: 'Save',
        hidden: { draft: sealed },
        ...(returnTo ? { returnTo } : {}),
        ...(fromLink ? { restart: start } : {}),
      }),
    );
  }

  return {
    manifest,
    fetch: async (request, _env, ctx) => {
      try {
        return await handle(request, ctx);
      } catch (error) {
        if (error instanceof AddonError) {
          const response = json({ error: error.message }, error.status);
          if (
            error.retryAfter !== undefined &&
            Number.isFinite(error.retryAfter) &&
            error.retryAfter >= 0
          )
            response.headers.set('Retry-After', String(Math.round(error.retryAfter)));
          return response;
        }
        options.onError?.(error, request);
        return json({ error: 'The add-on failed to answer' }, 500);
      }
    },
  };
}
