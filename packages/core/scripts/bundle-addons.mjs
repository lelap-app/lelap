// Writes src/addons/bundled/generated.ts from the add-on files next to it, with the manifest each
// declares, and generatedCode.ts with each file's code as text (Metro can't import a file as
// text). The code is a chunk of its own on the web, loaded when an add-on first runs (M126). Run it
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

const header = `// Written by scripts/bundle-addons.mjs from the add-on files in this folder; don't edit it.
`;
const manifests = entries.map(({ file, sha256, manifest }) => ({ file, sha256, manifest }));
writeFileSync(
  new URL('generated.ts', dir),
  `${header}
export const BUNDLED_FILES: { file: string; sha256: string; manifest: unknown }[] =
  ${JSON.stringify(manifests, null, 2)};
`,
);
const code = Object.fromEntries(entries.map((e) => [e.file, e.code]));
writeFileSync(
  new URL('generatedCode.ts', dir),
  `${header}
export const BUNDLED_CODE: Record<string, string> = ${JSON.stringify(code, null, 2)};
`,
);
console.log(`Bundled ${entries.map((e) => e.file).join(', ')}.`);
