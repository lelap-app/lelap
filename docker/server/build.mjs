// Bundles each Node entry into one file, so the runtime image needs Node and nothing else.
import { build } from 'esbuild';

for (const name of ['catalog', 'proxy', 'sync', 'updates']) {
  await build({
    entryPoints: [`src/${name}.ts`],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'esm',
    outfile: `dist/${name}.mjs`,
    loader: { '.sql': 'text' },
    // node:sqlite and friends come with Node.
    external: ['node:*'],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    logLevel: 'warning',
  });
}
