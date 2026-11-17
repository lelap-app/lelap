// Over-the-air update for the tag workflow (M18), run with Node's type stripping:
//   node scripts/ota.mts DIST CONFIG RUNTIME BASE_URL CREATED_AT CHANNEL OUT
// DIST is `expo export --platform android` output, CONFIG the `expo config --type public --json`
// output. The private key comes from OTA_SIGNING_KEY (PEM) and never touches the disk. OUT gets
// the files to upload, under the same keys as in the downloads bucket:
//   OUT/ota/<runtime>/<id>/<md5>.<ext>          the bundle and assets (immutable)
//   OUT/ota/channels/<channel>/<runtime>.json   the signed manifest (uploaded last)
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  type BundleFile,
  buildManifest,
  fileName,
  updateIdFrom,
} from '../services/updates/src/manifest.ts';
import {
  CHANNELS,
  type Published,
  publishedKey,
  SAFE_NAME,
} from '../services/updates/src/published.ts';

const [dist, configFile, runtimeVersion, baseUrl, createdAt, channel, out] = process.argv.slice(2);
if (!dist || !configFile || !runtimeVersion || !baseUrl || !createdAt || !channel || !out) {
  console.error('Usage: ota.mts DIST CONFIG RUNTIME BASE_URL CREATED_AT CHANNEL OUT');
  process.exit(1);
}
if (!SAFE_NAME.test(runtimeVersion) || !(CHANNELS as readonly string[]).includes(channel)) {
  console.error(`Bad runtime version or channel: ${runtimeVersion} ${channel}`);
  process.exit(1);
}
const key = process.env.OTA_SIGNING_KEY;
if (!key) {
  console.error('OTA_SIGNING_KEY is not set.');
  process.exit(1);
}

type Metadata = {
  fileMetadata: { android: { bundle: string; assets: { path: string; ext: string }[] } };
};
const metadata = JSON.parse(readFileSync(join(dist, 'metadata.json'), 'utf8')) as Metadata;
const android = metadata.fileMetadata.android;

const describe = (path: string, ext: string): BundleFile & { path: string } => {
  const bytes = readFileSync(join(dist, path));
  return {
    path,
    ext,
    sha256: createHash('sha256').update(bytes).digest('base64url'),
    md5: createHash('md5').update(bytes).digest('hex'),
  };
};

const launchAsset = describe(android.bundle, 'bundle');
const assets = android.assets.map((asset) => describe(asset.path, asset.ext));
const id = updateIdFrom(
  createHash('sha256')
    .update([runtimeVersion, launchAsset.sha256, ...assets.map((a) => a.sha256)].join('\n'))
    .digest('hex'),
);
const folder = `ota/${runtimeVersion}/${id}`;

for (const file of [launchAsset, ...assets]) {
  const target = join(out, folder, fileName(file));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(dist, file.path), target);
}

const expoClient = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
const manifest = buildManifest({
  id,
  createdAt: new Date(createdAt).toISOString(),
  runtimeVersion,
  launchAsset,
  assets,
  baseUrl: `${baseUrl.replace(/\/$/, '')}/${folder}`,
  expoClient,
});
const signature = sign('sha256', Buffer.from(manifest, 'utf8'), createPrivateKey(key)).toString(
  'base64',
);
const published: Published = { manifest, signature, keyId: 'main' };
const record = join(out, publishedKey(channel, runtimeVersion));
mkdirSync(dirname(record), { recursive: true });
writeFileSync(record, JSON.stringify(published));

console.log(JSON.stringify({ id, runtimeVersion, channel, files: assets.length + 1 }));
