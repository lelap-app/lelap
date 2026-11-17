// Release helpers for the tag workflow, run with Node's type stripping:
//   node scripts/release.mts stamp v1.2.3                 sets the app's version and versionCode
//   node scripts/release.mts apk v1.2.3 ABI [fdroid]      prints the APK's file name and versionCode
//   node scripts/release.mts info v1.2.3 DIR BASE_URL     prints latest.json for the APKs in DIR
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ABIS,
  abiVersionCode,
  apkName,
  channelOf,
  formatVersion,
  isAbi,
  parseVersion,
  ReleaseInfo,
  versionCode,
} from '../packages/core/src/release.ts';

const [command, tag, arg1, arg2] = process.argv.slice(2);
const version = parseVersion(tag ?? '');
if (!version) {
  console.error(`Not a release tag: ${tag ?? '(none)'}. Use v1.2.3 or v1.2.3-beta.4.`);
  process.exit(1);
}

/** Prints `key=value` lines, and appends them to the step's outputs in GitHub Actions. */
function output(values: Record<string, string>) {
  const lines = Object.entries(values)
    .map(([k, v]) => `${k}=${v}\n`)
    .join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
  process.stdout.write(lines);
}

if (command === 'stamp') {
  // The base code; the Gradle build turns it into one per CPU type (plugins/withArchitectures.js).
  const path = 'apps/app/app.json';
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.expo.version = formatVersion(version);
  config.expo.android.versionCode = versionCode(version);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  output({
    version: formatVersion(version),
    code: String(versionCode(version)),
    channel: channelOf(version),
  });
} else if (command === 'apk' && arg1 && isAbi(arg1) && (arg2 === undefined || arg2 === 'fdroid')) {
  output({
    name: apkName(version, arg1, arg2 === 'fdroid' ? 'fdroid' : 'direct'),
    code: String(abiVersionCode(version, arg1)),
  });
} else if (command === 'info' && arg1 && arg2) {
  const apks = ABIS.map((abi) => {
    const name = apkName(version, abi);
    const bytes = readFileSync(join(arg1, name));
    return {
      abi,
      versionCode: abiVersionCode(version, abi),
      url: `${arg2}/apk/${name}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    };
  });
  // The arm64 APK also fills the top-level fields that apps from before M54 read.
  const main = apks.find((apk) => apk.abi === 'arm64-v8a');
  if (!main) throw new Error('No arm64-v8a APK');
  const info = ReleaseInfo.parse({
    version: formatVersion(version),
    versionCode: main.versionCode,
    url: main.url,
    sha256: main.sha256,
    size: main.size,
    apks,
    minSdk: 26,
    notes: `https://github.com/lelap-app/lelap/releases/tag/${tag}`,
    publishedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify(info, null, 2));
} else {
  console.error(
    `Usage: release.mts stamp TAG | apk TAG ${ABIS.join('|')} [fdroid] | info TAG APK_DIR BASE_URL`,
  );
  process.exit(1);
}
