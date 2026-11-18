// Writes dist/protocol.schema.json, the JSON Schema of every protocol response, for the docs.
import { mkdirSync, writeFileSync } from 'node:fs';

import { z } from 'zod';

import {
  CatalogResponse,
  HealthResponse,
  LibraryResponse,
  Manifest,
  MetaResponse,
  PROTOCOL_VERSION,
  ScrobbleRequest,
  StreamResponse,
} from '../src/protocol.ts';

const out = new URL('../dist/', import.meta.url);
mkdirSync(out, { recursive: true });

const registry = z.registry();
registry.add(Manifest, { id: 'Manifest' });
registry.add(CatalogResponse, { id: 'CatalogResponse' });
registry.add(MetaResponse, { id: 'MetaResponse' });
registry.add(StreamResponse, { id: 'StreamResponse' });
registry.add(ScrobbleRequest, { id: 'ScrobbleRequest' });
registry.add(HealthResponse, { id: 'HealthResponse' });
registry.add(LibraryResponse, { id: 'LibraryResponse' });

const { schemas } = z.toJSONSchema(registry, {
  io: 'output',
  target: 'draft-2020-12',
  uri: (id) => `#/$defs/${id}`,
});
// Each entry repeats `$schema`; the document declares it once.
const $defs = Object.fromEntries(
  Object.entries(schemas).map(([id, entry]) => {
    const rest = { ...entry };
    delete rest.$schema;
    return [id, rest];
  }),
);
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: `Lelap add-on protocol v${PROTOCOL_VERSION}`,
  $defs,
};
writeFileSync(new URL('protocol.schema.json', out), `${JSON.stringify(schema, null, 2)}\n`);
