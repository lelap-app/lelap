// Release helpers for the tag workflow, run with Node's type stripping:
//   node scripts/release.mts stamp v1.2.3                 sets the app's version and versionCode
//   node scripts/release.mts committed v1.2.3             checks app.json already carries them
//   node scripts/release.mts apk v1.2.3 ABI [fdroid]      prints the APK's file name and versionCode
//   node scripts/release.mts info v1.2.3 DIR BASE_URL [RUNTIME]
//                                                         prints latest.json for the APKs in DIR
//   node scripts/release.mts apk-update PREVIOUS RUNTIME OTA
//                                                         whether latest.json or beta.json changes
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ABIS,
  abiVersionCode,
  apkName,
  apkUpdateNeeded,
  channelOf,
  formatVersion,
  isAbi,
  parseVersion,
  ReleaseInfo,
  versionCode,
} from '../packages/core/src/release.ts';

const [command, tag, arg1, arg2, arg3] = process.argv.slice(2);

/** Prints `key=value` lines, and appends them to the step's outputs in GitHub Actions. */
function output(values: Record<string, string>) {
  const lines = Object.entries(values)
    .map(([k, v]) => `${k}=${v}\n`)
    .join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
  process.stdout.write(lines);
}

// The one command without a tag. PREVIOUS is the release file on the downloads host (missing or
// not JSON when there is none); OTA is `true` when the over-the-air job succeeded.
if (command === 'apk-update') {
  const [previousFile, runtime, ota] = [tag, arg1, arg2];
  let previous: unknown = null;
  try {
    if (previousFile && existsSync(previousFile)) {
      previous = JSON.parse(readFileSync(previousFile, 'utf8'));
    }
  } catch {
    previous = null;
  }
  output({ apk: String(apkUpdateNeeded(previous, runtime ?? '', ota === 'true')) });
  process.exit(0);
}

const version = parseVersion(tag ?? '');
if (!version) {
  console.error(`Not a release tag: ${tag ?? '(none)'}. Use v1.2.3 or v1.2.3-beta.4.`);
  process.exit(1);
}

if (command === 'committed') {
  // F-Droid's update check reads the base versionCode from app.json at the tag
  // (docs/fdroid/app.lelap.yml), so the release pull request stamps and commits it.
  const config = JSON.parse(readFileSync('apps/app/app.json', 'utf8'));
  const found = `${config.expo.version} (${config.expo.android?.versionCode})`;
  const wanted = `${formatVersion(version)} (${versionCode(version)})`;
  if (found !== wanted) {
    const message = `apps/app/app.json has ${found}, not ${wanted}. Run \`node scripts/release.mts stamp ${tag}\` and commit app.json in the release pull request.`;
    // F-Droid only follows stable tags; a beta without it still builds.
    if (channelOf(version) === 'stable') {
      console.error(`::error::${message}`);
      process.exit(1);
    }
    console.log(`::warning::${message}`);
  }
} else if (command === 'stamp') {
  // The base code; the Gradle build turns it into one per CPU type (plugins/withArchitectures.js).
  // Replaced in place, so the file keeps Prettier's layout: release pull requests commit it.
  const path = 'apps/app/app.json';
  const text = readFileSync(path, 'utf8')
    .replace(/("version":\s*)"[^"]*"/, `$1"${formatVersion(version)}"`)
    .replace(/("versionCode":\s*)\d+/, `$1${versionCode(version)}`);
  const config = JSON.parse(text);
  if (
    config.expo.version !== formatVersion(version) ||
    config.expo.android.versionCode !== versionCode(version)
  ) {
    throw new Error(`Could not stamp ${path}: expo.version or expo.android.versionCode not found`);
  }
  writeFileSync(path, text);
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
  const runtime = arg3;
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
    ...(runtime ? { runtime } : {}),
  });
  console.log(JSON.stringify(info, null, 2));
} else {
  console.error(
    `Usage: release.mts stamp TAG | committed TAG | apk TAG ${ABIS.join('|')} [fdroid] | info TAG APK_DIR BASE_URL [RUNTIME] | apk-update PREVIOUS RUNTIME OTA`,
  );
  process.exit(1);
}
