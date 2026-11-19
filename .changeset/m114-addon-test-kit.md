---
'@lelap/sdk': minor
---

The add-on test kit. `lelap-sdk check <url>` (or `npx @lelap/sdk check <url>`) fetches an add-on's
manifest and every resource it declares, validates each answer with the SDK's schemas and says
what is wrong: the field, what was expected and the address that answered. It also checks CORS,
response times, caching headers, catalog paging that ends, IDs that come back unchanged, stream
addresses and configure pages that use `PAGE_STYLE`. `--json` prints the report for CI; the exit
code is 0 when it passes, 1 for problems and 2 for wrong use. `checkAddon(url, { fetch })` and
`formatReport`, from `@lelap/sdk/check`, do the same from code, so a test can check `addon.fetch`
without a server.
