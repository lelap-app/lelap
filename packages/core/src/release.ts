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
  if (minor > 99 || patch > 99 || (beta !== null && (beta < 1 || beta > 98))) return null;
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

export type Channel = 'stable' | 'beta';

export const channelOf = (v: Version): Channel => (v.beta === null ? 'stable' : 'beta');

/** `latest.json` (stable) and `beta.json` on the downloads host. */
export const ReleaseInfo = z.object({
  version: z.string().min(1),
  versionCode: z.number().int().positive(),
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive(),
  minSdk: z.number().int().positive().optional(),
  notes: z.string().optional(),
  publishedAt: z.string(),
});
export type ReleaseInfo = z.infer<typeof ReleaseInfo>;

/** The release to offer, if any: beta testers get whichever of beta and stable is newer. */
export function pickUpdate(
  currentCode: number,
  channel: Channel,
  stable: ReleaseInfo | null,
  beta: ReleaseInfo | null,
): ReleaseInfo | null {
  const candidates = channel === 'beta' ? [stable, beta] : [stable];
  const best = candidates
    .filter((r): r is ReleaseInfo => r !== null)
    .sort((a, b) => b.versionCode - a.versionCode)[0];
  return best && best.versionCode > currentCode ? best : null;
}
