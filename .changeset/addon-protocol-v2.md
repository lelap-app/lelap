---
'@lelap/sdk': minor
---

Protocol revision 2, backward compatible with v1 add-ons and apps:

- `protocolVersion` in the manifest (absent means 1) and `LATEST_PROTOCOL_VERSION`.
- `behaviorHints`: `configurable`, `configurationRequired` and `health`, with helpers
  `isConfigurable`, `needsConfiguration`, `offersHealth` and `protocolVersionOf`.
- `GET /health` and the `HealthResponse` schema; `createAddon` answers it (or calls your `health`
  handler) and declares it.
- `createAddon({ configure })` serves a settings form at `/configure`, encodes the settings into a
  `/{token}/` prefix of the add-on's URL (AES-GCM with `configure.secret`), sends the listener back
  to `lelap://addon?manifest=…` and passes `config` to every handler. `encodeConfig`,
  `decodeConfig` and `allowedReturn` are exported for add-ons that route themselves.
