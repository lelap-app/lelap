# @lelap/sdk

## 0.3.0

### Minor Changes

- dc678c3: Protocol revision 2, backward compatible with v1 add-ons and apps:

  - `protocolVersion` in the manifest (absent means 1) and `LATEST_PROTOCOL_VERSION`.
  - `behaviorHints`: `configurable`, `configurationRequired` and `health`, with helpers
    `isConfigurable`, `needsConfiguration`, `offersHealth` and `protocolVersionOf`.
  - `GET /health` and the `HealthResponse` schema; `createAddon` answers it (or calls your `health`
    handler) and declares it.
  - `createAddon({ configure })` serves a settings form at `/configure`, encodes the settings into a
    `/{token}/` prefix of the add-on's URL (AES-GCM with `configure.secret`), sends the listener back
    to `lelap://addon?manifest=…` and passes `config` to every handler. `encodeConfig`,
    `decodeConfig` and `allowedReturn` are exported for add-ons that route themselves.

- 5bb1025: Protocol revision 3 adds the `artwork` resource: `GET /artwork/{type}/{id}.json` answers
  `{ artwork: ArtworkImage[] }` (`url`, `kind`, `width`, `height`). New `ArtworkImage`,
  `ArtworkResponse` and `artworkPath`; `parseRoute` knows the route and `createAddon({ artwork })`
  serves it. `LATEST_PROTOCOL_VERSION` is now 3.
- e3080d3: Manifest `sandbox.hosts` (revision 3) for add-ons that run inside the app: the only hosts the app
  fetches from for the add-on.

## 0.2.1

### Patch Changes

- README: link the SDK guide, protocol reference and samples on the docs site instead of their source
  files.

## 0.2.0

### Minor Changes

- 6ec055b: First release on npm: ESM with type declarations, built from the TypeScript source, and the
  protocol's JSON Schema at `@lelap/sdk/protocol.schema.json`.
