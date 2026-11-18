import { z } from 'zod';

// Release versions: tags `v1.2.3` (stable) and `v1.2.3-beta.4` (beta). Imports nothing relative,
// so the release workflow runs this file directly with Node's type stripping.

export type Version = { major: number; minor: number; patch: number; beta: number | null };

const TAG = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

export function parseVersion(tag: string): Version | null {
  const m = TAG.exec(tag.trim());
  if (!m) return null;
  const [major, minor, patch] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
  const beta = m[4] === undefined ? null : Number(m[4]);
  // Major 209 keeps abiVersionCode under Android's limit of 2,100,000,000.
  if (major > 209 || minor > 99 || patch > 99 || (beta !== null && (beta < 1 || beta > 98)))
    return null;
  return { major, minor, patch, beta };
}

export const formatVersion = (v: Version) =>
  `${v.major}.${v.minor}.${v.patch}${v.beta === null ? '' : `-beta.${v.beta}`}`;

/**
 * Android's versionCode: always growing, and a beta below its release (`1.2.0-beta.3` <
 * `1.2.0`), so beta testers move on to the release.
 */
export function versionCode(v: Version): number {
  return v.major * 1_000_000 + v.minor * 10_000 + v.patch * 100 + (v.beta ?? 99);
}

/** The CPU types release APKs are built for, one APK each. The first is the default download. */
export const ABIS = ['arm64-v8a', 'armeabi-v7a'] as const;
export type Abi = (typeof ABIS)[number];

// The last digit of a per-CPU versionCode. 64-bit sits above 32-bit, so a phone that runs both
// prefers it. `plugins/withArchitectures.js` writes the same digits into the Gradle build.
const ABI_DIGIT: Record<Abi, number> = { 'armeabi-v7a': 1, 'arm64-v8a': 2 };

/**
 * The versionCode of one CPU type's APK: `versionCode(v)` times ten plus a digit for the CPU.
 * Times ten keeps every such code above the single-APK codes of releases before M54.
 */
export function abiVersionCode(v: Version, abi: Abi): number {
  return versionCode(v) * 10 + ABI_DIGIT[abi];
}

export const isAbi = (value: string): value is Abi => (ABIS as readonly string[]).includes(value);

/** File names on the downloads host and GitHub Releases: the arm64 APK keeps the plain name. */
export function apkName(
  v: Version,
  abi: Abi,
  distribution: 'direct' | 'fdroid' = 'direct',
): string {
  const suffix = `${distribution === 'fdroid' ? '-fdroid' : ''}${abi === 'arm64-v8a' ? '' : '-armv7'}`;
  return `lelap-${formatVersion(v)}${suffix}.apk`;
}

export type Channel = 'stable' | 'beta';

export const channelOf = (v: Version): Channel => (v.beta === null ? 'stable' : 'beta');

const ApkInfo = z.object({
  // A string, not the ABIS enum: a release that adds a CPU type must not break older apps.
  abi: z.string().min(1),
  versionCode: z.number().int().positive(),
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive(),
});
export type ApkInfo = z.infer<typeof ApkInfo>;

/**
 * `latest.json` (stable) and `beta.json` on the downloads host. The top-level `versionCode`,
 * `url`, `sha256` and `size` are the arm64 APK's: apps from before M54 read only those. `apks`
 * lists one APK per CPU type.
 */
export const ReleaseInfo = z.object({
  version: z.string().min(1),
  versionCode: z.number().int().positive(),
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive(),
  apks: z.array(ApkInfo).optional(),
  minSdk: z.number().int().positive().optional(),
  notes: z.string().optional(),
  publishedAt: z.string(),
  /** The APKs' native fingerprint (expo-updates runtime version); the workflow reads it back. */
  runtime: z.string().min(1).optional(),
});
export type ReleaseInfo = z.infer<typeof ReleaseInfo>;

/**
 * Whether a release must replace the published `latest.json` or `beta.json`. Not when the release
 * on the downloads host has the same native fingerprint and the over-the-air bundle went out:
 * the APK would bring only JavaScript that apps of that runtime already receive. Anything
 * unreadable counts as a change, so a doubt publishes the APK.
 */
export function apkUpdateNeeded(
  previous: unknown,
  runtime: string,
  otaPublished: boolean,
): boolean {
  if (!otaPublished || !runtime) return true;
  const parsed = ReleaseInfo.safeParse(previous);
  return !parsed.success || parsed.data.runtime !== runtime;
}

/**
 * Picks one of the offered CPU types for this device, or null when it runs none of them. On
 * Android this is the updater module's choice from `Build.SUPPORTED_ABIS`.
 */
export type AbiChooser = (offered: string[]) => string | null;

/** The release with its top-level APK fields set to the APK this device should install. */
function forDevice(release: ReleaseInfo, chooseAbi: AbiChooser): ReleaseInfo | null {
  if (!release.apks?.length) return release;
  const abi = chooseAbi(release.apks.map((apk) => apk.abi));
  const apk = release.apks.find((a) => a.abi === abi);
  if (!apk) return null;
  return {
    ...release,
    versionCode: apk.versionCode,
    url: apk.url,
    sha256: apk.sha256,
    size: apk.size,
  };
}

/**
 * The release to offer, if any: beta testers get whichever of beta and stable is newer. A release
 * that lists APKs per CPU type is offered with the one `chooseAbi` picks, and not at all when it
 * has none for this device.
 */
export function pickUpdate(
  currentCode: number,
  channel: Channel,
  stable: ReleaseInfo | null,
  beta: ReleaseInfo | null,
  chooseAbi: AbiChooser,
): ReleaseInfo | null {
  const candidates = channel === 'beta' ? [stable, beta] : [stable];
  const best = candidates
    .filter((r): r is ReleaseInfo => r !== null)
    .map((r) => forDevice(r, chooseAbi))
    .filter((r): r is ReleaseInfo => r !== null)
    .sort((a, b) => b.versionCode - a.versionCode)[0];
  return best && best.versionCode > currentCode ? best : null;
}
