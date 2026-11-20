// Checks every catalog in src/i18n/catalogs against the English text in the source, so a
// contributed language gets clear messages in CI:
// - the file is valid JSON with only text values and a `@language` name;
// - every key is still used by the app, written once, and keeps the English `{holes}`;
// - both forms of a plural are translated, or neither;
// - native code (Kotlin) only uses lines listed in src/nativeText.ts, and uses every one;
// - src/i18n/template.json lists every line (rewritten here outside CI).
// Missing lines are listed but don't fail, since the app shows English until a translation arrives.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const repo = join(root, '../..');
const catalogs = join(root, 'src/i18n/catalogs');
const files = (dir, test) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === 'i18n' || name === 'build' ? [] : files(path, test);
    return test.test(name) ? [path] : [];
  });
const unquote = (quoted) => quoted.slice(1, -1).replace(/\\(.)/g, '$1');

// t('…') and t("…"), also when the formatter put the text on its own line.
const call = /\bt\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
// Plurals are written as `n === 1 ? t('1 book') : t('{n} books', { n })`; the first call's
// values may hold calls of their own, such as `{ size: formatBytes(bytes) }`.
const plural =
  /\bt\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")(?:[^()]|\([^()]*\))*\)\s*:\s*t\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
const used = new Set();
const pairs = [];
// Core can't import t(); a core file that takes the app's as a `Translate` writes its lines the same way.
const core = files(join(repo, 'packages/core/src'), /^(?!.*\.test\.ts$).*\.ts$/).filter((file) =>
  /\bt: Translate\b/.test(readFileSync(file, 'utf8')),
);
for (const file of [
  ...files(join(root, 'app'), /\.tsx?$/),
  ...files(join(root, 'src'), /\.tsx?$/),
  ...core,
]) {
  const source = readFileSync(file, 'utf8');
  for (const m of source.matchAll(call)) used.add(unquote(m[1]));
  for (const m of source.matchAll(plural)) {
    const [one, many] = [unquote(m[1]), unquote(m[2])];
    // Other ternaries pick between two sentences; a plural has the 1 on one side, a hole on the other.
    if (/\b1\b/.test(one) && /\{\w+\}/.test(many)) pairs.push([one, many]);
  }
}

const problems = [];
const report = (file, key, message) => problems.push({ file, key, message });

// Native code: `text.t("…")`, `NativeText.t(context, "…")` and `NativeText.channel(…, "…", …)`.
const nativeFile = join(root, 'src/nativeText.ts');
const native = new Set(
  [...readFileSync(nativeFile, 'utf8').matchAll(call)].map((m) => unquote(m[1])),
);
const kotlinCall = /\.(?:t\(\s*(?:[\w@.]+\s*,\s*)?|channel\([^,]+,[^,]+,\s*)("(?:[^"\\]|\\.)*")/g;
const kotlinUsed = new Set();
const modules = readdirSync(join(repo, 'modules'), { withFileTypes: true }).filter((d) =>
  d.isDirectory(),
);
for (const file of modules.flatMap((m) => {
  const dir = join(repo, 'modules', m.name, 'android/src/main');
  return statSync(dir, { throwIfNoEntry: false }) ? files(dir, /\.kt$/) : [];
})) {
  for (const m of readFileSync(file, 'utf8').matchAll(kotlinCall)) {
    const key = unquote(m[1]);
    kotlinUsed.add(key);
    if (!native.has(key))
      report(file, key, `Native code uses a line that src/nativeText.ts doesn't list`);
  }
}
for (const key of native) {
  if (!kotlinUsed.has(key))
    report(nativeFile, key, 'Listed for native code, which no longer uses it');
}

const holes = (s) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(', ');
const summary = [];
for (const name of readdirSync(catalogs)
  .filter((n) => n.endsWith('.json'))
  .sort()) {
  const file = join(catalogs, name);
  const code = name.slice(0, -'.json'.length);
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) {
    report(file, null, `The file name must be a language code, such as ms.json or pt-BR.json`);
    continue;
  }
  if (code === 'en') {
    report(file, null, 'English is the text in the code itself; it has no catalog file');
    continue;
  }
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    report(file, null, `Not valid JSON: ${error.message}. Check for a missing comma or quote.`);
    continue;
  }
  if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
    report(file, null, 'The catalog must be one JSON object: { "English": "translation", … }');
    continue;
  }
  // JSON.parse keeps only the last of a key written twice, so look for them in the text.
  const seen = new Set();
  for (const m of readFileSync(file, 'utf8').matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:/gm)) {
    const key = JSON.parse(m[1]);
    if (seen.has(key)) report(file, key, 'Written twice in this file: keep one');
    seen.add(key);
  }
  if (typeof catalog['@language'] !== 'string' || !catalog['@language'].trim())
    report(
      file,
      null,
      'Add "@language": the language’s name in that language, such as "Bahasa Melayu"',
    );
  const translated = (key) => typeof catalog[key] === 'string' && catalog[key] !== '';
  for (const [key, line] of Object.entries(catalog)) {
    if (key === '@language') continue;
    if (typeof line !== 'string') report(file, key, 'The translation must be text in "quotes"');
    else if (!used.has(key))
      report(file, key, 'Not used in the app any more: remove it, or update it to the new English');
    else if (line !== '' && holes(key) !== holes(line))
      report(
        file,
        key,
        `Keep the {holes} of the English (${holes(key) || 'none'}); this line has ${holes(line) || 'none'}`,
      );
  }
  for (const [one, many] of pairs) {
    if (translated(one) !== translated(many)) {
      const [done, missing] = translated(one) ? [one, many] : [many, one];
      report(file, done, `Translate the other form of this plural too, ${JSON.stringify(missing)}`);
    }
  }
  const missing = [...used].filter((key) => !translated(key)).sort();
  if (missing.length > 0 && process.argv.includes('--missing')) {
    console.log(`${name}: ${missing.length} lines without a translation yet (English shows):`);
    for (const key of missing) console.log(`  ${JSON.stringify(key)}`);
  }
  summary.push(`${name}: ${used.size - missing.length} of ${used.size} lines`);
}

// template.json is where a new language starts: every line the app uses, untranslated. It is kept
// current here, so a translator never has to run anything to get the list.
const templateFile = join(root, 'src/i18n/template.json');
const template =
  JSON.stringify(
    Object.fromEntries([['@language', ''], ...[...used].sort().map((key) => [key, ''])]),
    null,
    2,
  ) + '\n';
if (readFileSync(templateFile, { encoding: 'utf8', flag: 'a+' }) !== template) {
  if (process.env.CI) {
    report(
      templateFile,
      null,
      'Out of date: run `pnpm --filter @lelap/app test` and commit src/i18n/template.json',
    );
  } else {
    writeFileSync(templateFile, template);
    console.log('Updated src/i18n/template.json; commit it with your change.');
  }
}

const lineOf = (file, key) => {
  if (key === null || !file.endsWith('.json')) return 1;
  const index = readFileSync(file, 'utf8').indexOf(`${JSON.stringify(key)}:`);
  return index < 0 ? 1 : readFileSync(file, 'utf8').slice(0, index).split('\n').length;
};
for (const { file, key, message } of problems) {
  const where = `${relative(repo, file)}:${lineOf(file, key)}`;
  const text = key === null ? message : `${JSON.stringify(key)}: ${message}`;
  console.error(`${where}  ${text}`);
  // Shown on the changed line in a pull request.
  if (process.env.GITHUB_ACTIONS)
    console.error(`::error file=${relative(repo, file)},line=${lineOf(file, key)}::${text}`);
}
console.log(`Translations: ${summary.join(', ')}. Add --missing to list what is left.`);
if (problems.length > 0) process.exit(1);
