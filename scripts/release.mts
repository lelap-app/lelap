// Release helpers for the tag workflow, run with Node's type stripping:
//   node scripts/release.mts stamp v1.2.3          sets the app's version and versionCode
//   node scripts/release.mts info v1.2.3 FILE URL  prints latest.json for the APK at URL
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';

import {
  channelOf,
  formatVersion,
  parseVersion,
  ReleaseInfo,
  versionCode,
} from '../packages/core/src/release.ts';

const [command, tag, file, url] = process.argv.slice(2);
const version = parseVersion(tag ?? '');
if (!version) {
  console.error(`Not a release tag: ${tag ?? '(none)'}. Use v1.2.3 or v1.2.3-beta.4.`);
  process.exit(1);
}

if (command === 'stamp') {
  const path = 'apps/app/app.json';
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.expo.version = formatVersion(version);
  config.expo.android.versionCode = versionCode(version);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  const outputs = {
    version: formatVersion(version),
    code: String(versionCode(version)),
    channel: channelOf(version),
  };
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(''),
    );
  }
  console.log(outputs);
} else if (command === 'info' && file && url) {
  const bytes = readFileSync(file);
  const info = ReleaseInfo.parse({
    version: formatVersion(version),
    versionCode: versionCode(version),
    url,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: statSync(file).size,
    minSdk: 26,
    notes: `https://github.com/lelap-app/lelap/releases/tag/${tag}`,
    publishedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify(info, null, 2));
} else {
  console.error('Usage: release.mts stamp TAG | info TAG APK_FILE URL');
  process.exit(1);
}
