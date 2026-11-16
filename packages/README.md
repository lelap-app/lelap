# packages

Shared TypeScript packages:

- `core`: domain model, library logic, the Drizzle schema and the add-on client; tested with
  Vitest (`pnpm test`). Later the ID graph, download queue and sync.
- `sdk`: the add-on protocol (v1) as zod schemas and types, and `createAddon()`, which turns
  handlers into a `fetch(request)` handler for Workers, Deno, Bun or Node. MIT; published to npm
  later. `pnpm --filter @lelap/sdk build` writes `dist/protocol.schema.json`.

See [`docs/brief.md`](../docs/brief.md).
