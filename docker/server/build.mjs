// Bundles each Node entry into one file, so the runtime image needs Node and nothing else.
import { readFileSync } from 'node:fs';

import { build } from 'esbuild';

// The admin pages show it: the app's release, which the release tag carries too.
const version =
  process.env.LELAP_VERSION ||
  JSON.parse(readFileSync(new URL('../../apps/app/app.json', import.meta.url), 'utf8')).expo
    .version;

// `sync-db` is the sync image's backup and restore tool.
const entries = {
  catalog: 'catalog',
  proxy: 'proxy',
  sync: 'sync',
  updates: 'updates',
  'sync-db': 'syncDb',
};

for (const [out, source] of Object.entries(entries)) {
  await build({
    entryPoints: [`src/${source}.ts`],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    outfile: `dist/${out}.mjs`,
    loader: { '.sql': 'text' },
    define: { __LELAP_VERSION__: JSON.stringify(version) },
    // node:sqlite and friends come with Node.
    external: ['node:*'],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
}
