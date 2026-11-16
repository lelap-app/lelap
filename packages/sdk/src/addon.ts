import type { ZodType } from 'zod';

import { type Extra, parseRoute } from './paths';
import {
  type CatalogResponse,
  CatalogResponse as CatalogResponseSchema,
  type ContentType,
  Manifest as ManifestSchema,
  type Manifest,
  type MetaResponse,
  MetaResponse as MetaResponseSchema,
  type StreamResponse,
  StreamResponse as StreamResponseSchema,
} from './protocol';

type Awaitable<T> = T | Promise<T>;

export type CatalogArgs = { type: ContentType; id: string; extra: Extra; request: Request };
export type ItemArgs = { type: ContentType; id: string; request: Request };

export type AddonHandlers = {
  manifest: Manifest;
  catalog?: (args: CatalogArgs) => Awaitable<CatalogResponse>;
  /** Return `null` when the ID is unknown; the response is then a 404. */
  meta?: (args: ItemArgs) => Awaitable<MetaResponse | null>;
  stream?: (args: ItemArgs) => Awaitable<StreamResponse>;
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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export class AddonError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
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
  const manifest = ManifestSchema.parse(handlers.manifest);
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
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return json({ error: 'Method not allowed' }, 405);

    const { pathname } = new URL(request.url);
    if (base && pathname !== base && !pathname.startsWith(`${base}/`))
      return json({ error: 'Not found' }, 404);
    const route = parseRoute(pathname.slice(base.length));
    if (!route) return json({ error: 'Not found' }, 404);

    if (route.resource === 'manifest') return json(manifest, 200, 3600);
    if (!typesFor(route.resource).includes(route.type)) return json({ error: 'Not found' }, 404);

    switch (route.resource) {
      case 'catalog': {
        if (!handlers.catalog) break;
        const known = manifest.catalogs.some((c) => c.type === route.type && c.id === route.id);
        if (!known) return json({ error: 'Unknown catalog' }, 404);
        const body = checked(
          CatalogResponseSchema,
          await handlers.catalog({ ...route, request }),
          validate,
        );
        return json(body, 200, body.cacheMaxAge);
      }
      case 'meta': {
        if (!handlers.meta) break;
        const result = await handlers.meta({ ...route, request });
        if (!result) return json({ error: 'Not found' }, 404);
        const body = checked(MetaResponseSchema, result, validate);
        return json(body, 200, body.cacheMaxAge);
      }
      case 'stream': {
        if (!handlers.stream) break;
        const body = checked(
          StreamResponseSchema,
          await handlers.stream({ ...route, request }),
          validate,
        );
        return json(body, 200, body.cacheMaxAge);
      }
    }
    return json({ error: 'Not found' }, 404);
  };

  return {
    manifest,
    fetch: async (request) => {
      try {
        return await handle(request);
      } catch (error) {
        if (error instanceof AddonError) return json({ error: error.message }, error.status);
        options.onError?.(error, request);
        return json({ error: 'The add-on failed to answer' }, 500);
      }
    },
  };
}
