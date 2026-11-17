// Builds the Expo Updates manifest the release workflow signs (`scripts/ota.mts`). Pure and
// without imports, so Node runs it with type stripping and the tests run it as it is.

export type BundleFile = {
  /** base64url SHA-256 of the file: the app checks every download against it. */
  sha256: string;
  /** Hex MD5 of the file: expo-updates stores assets under this key. */
  md5: string;
  /** Without the dot, such as `png`; `bundle` for the launch asset. */
  ext: string;
};

export type ManifestInput = {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: BundleFile;
  assets: BundleFile[];
  /** Where `fileName()` files are published, such as `https://dl.example.org/ota/<rt>/<id>`. */
  baseUrl: string;
  /** The public Expo config, so `Constants.expoConfig` keeps working after an update. */
  expoClient: Record<string, unknown>;
};

export const CONTENT_TYPES: Record<string, string> = {
  bundle: 'application/javascript',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: 'application/json',
};

export const contentType = (ext: string): string =>
  CONTENT_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';

/** Files are published flat, named by content, so the names are always safe storage keys. */
export const fileName = (file: BundleFile): string => `${file.md5}.${file.ext.toLowerCase()}`;

const entry = (file: BundleFile, baseUrl: string) => ({
  hash: file.sha256,
  key: file.md5,
  contentType: contentType(file.ext),
  fileExtension: `.${file.ext.toLowerCase()}`,
  url: `${baseUrl}/${fileName(file)}`,
});

/** The manifest text, exactly as it is signed and served. */
export function buildManifest(input: ManifestInput): string {
  const base = input.baseUrl.replace(/\/$/, '');
  return JSON.stringify({
    id: input.id,
    createdAt: input.createdAt,
    runtimeVersion: input.runtimeVersion,
    launchAsset: entry(input.launchAsset, base),
    assets: input.assets.map((file) => entry(file, base)),
    metadata: {},
    extra: { expoClient: input.expoClient },
  });
}

/**
 * The update ID from the bundle's content: the same code published twice (a beta, then the
 * stable release) is the same update, and devices that have it download nothing.
 */
export function updateIdFrom(sha256Hex: string): string {
  const hex = sha256Hex.toLowerCase().slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
