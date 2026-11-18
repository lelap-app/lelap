import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  CatalogResponse,
  HealthResponse,
  LibraryResponse,
  Manifest,
  MetaResponse,
  PROTOCOL_VERSION,
  ScrobbleRequest,
  SigninResult,
  SigninStart,
  StreamResponse,
} from '@lelap/sdk';

// Rendered at build time from the SDK's zod schemas, in the same shape as the SDK's
// `scripts/schema.mjs`, so the published schema can't drift from the code.
export const GET: APIRoute = () => {
  const registry = z.registry<{ id: string }>();
  registry.add(Manifest, { id: 'Manifest' });
  registry.add(CatalogResponse, { id: 'CatalogResponse' });
  registry.add(MetaResponse, { id: 'MetaResponse' });
  registry.add(StreamResponse, { id: 'StreamResponse' });
  registry.add(ScrobbleRequest, { id: 'ScrobbleRequest' });
  registry.add(HealthResponse, { id: 'HealthResponse' });
  registry.add(LibraryResponse, { id: 'LibraryResponse' });
  registry.add(SigninStart, { id: 'SigninStart' });
  registry.add(SigninResult, { id: 'SigninResult' });

  const { schemas } = z.toJSONSchema(registry, {
    io: 'output',
    target: 'draft-2020-12',
    uri: (id) => `#/$defs/${id}`,
  });
  // Each definition carries its own `$schema`; the document declares it once.
  const $defs = Object.fromEntries(
    Object.entries(schemas).map(([id, definition]) => {
      const rest = { ...definition };
      delete rest.$schema;
      return [id, rest];
    }),
  );
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `Lelap add-on protocol v${PROTOCOL_VERSION}`,
    $defs,
  };
  return new Response(`${JSON.stringify(schema, null, 2)}\n`, {
    headers: { 'Content-Type': 'application/schema+json; charset=utf-8' },
  });
};
