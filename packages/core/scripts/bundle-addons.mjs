// Writes src/addons/bundled/generated.ts from the add-on files next to it, so the app ships each
// file's code as text (Metro can't import a file as text) with the manifest it declares. Run it
// after changing a bundled add-on: `pnpm --filter @lelap/core bundle-addons`. A test fails when
// the generated file is out of date.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const dir = new URL('../src/addons/bundled/', import.meta.url);

const entries = readdirSync(dir)
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((file) => {
    const code = readFileSync(new URL(file, dir), 'utf8');
    let manifest = null;
    // Only `addon({ manifest })` runs here; nothing is fetched.
    runInNewContext(code, {
      addon: (definition) => {
        manifest = definition.manifest;
      },
      lelap: {},
      URL,
      TextEncoder,
      btoa,
    });
    if (!manifest) throw new Error(`${file} never calls addon({ manifest }).`);
    const sha256 = createHash('sha256').update(code).digest('hex');
    return { file, sha256, manifest, code };
  });

const out = `// Written by scripts/bundle-addons.mjs from the add-on files in this folder; don't edit it.

export const BUNDLED_FILES: { file: string; sha256: string; manifest: unknown; code: string }[] =
  ${JSON.stringify(entries, null, 2)};
`;
writeFileSync(new URL('generated.ts', dir), out);
console.log(`Bundled ${entries.map((e) => e.file).join(', ')}.`);
