import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  type AbiChooser,
  abiVersionCode,
  apkUpdateNeeded,
  apkName,
  channelOf,
  formatVersion,
  parseVersion,
  pickUpdate,
  ReleaseInfo,
  versionCode,
} from './release';

const version = (tag: string) => {
  const v = parseVersion(tag);
  if (!v) throw new Error(tag);
  return v;
};

// Build.SUPPORTED_ABIS of a phone, as the updater module uses it.
const device =
  (...supported: string[]): AbiChooser =>
  (offered) =>
    supported.find((abi) => offered.includes(abi)) ?? null;
const arm64Phone = device('arm64-v8a', 'armeabi-v7a', 'armeabi');
const arm32Phone = device('armeabi-v7a', 'armeabi');

/** A release file as the workflow writes it since M54: one APK per CPU type. */
const split = (tag: string): ReleaseInfo => {
  const v = version(tag);
  const apks = (['arm64-v8a', 'armeabi-v7a'] as const).map((abi) => ({
    abi,
    versionCode: abiVersionCode(v, abi),
    url: `https://dl.example.org/apk/${apkName(v, abi)}`,
    sha256: (abi === 'arm64-v8a' ? 'b' : 'c').repeat(64),
    size: abi === 'arm64-v8a' ? 37 : 29,
  }));
  const [main] = apks;
  if (!main) throw new Error('no APK');
  return {
    version: tag,
    versionCode: main.versionCode,
    url: main.url,
    sha256: main.sha256,
    size: main.size,
    apks,
    publishedAt: '2026-11-17T00:00:00Z',
  };
};

const release = (version: string): ReleaseInfo => {
  const v = parseVersion(version);
  if (!v) throw new Error(version);
  return {
    version,
    versionCode: versionCode(v),
    url: `https://dl.example.org/lelap-${version}.apk`,
    sha256: 'a'.repeat(64),
    size: 1,
    publishedAt: '2026-11-16T00:00:00Z',
  };
};

describe('release versions', () => {
  it('reads tags and orders betas before their release', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, beta: null });
    expect(parseVersion('v1.2.0-beta.4')).toEqual({ major: 1, minor: 2, patch: 0, beta: 4 });
    expect(parseVersion('v1.2')).toBeNull();
    expect(parseVersion('v1.100.0')).toBeNull();
    const code = (tag: string) =>
      versionCode(parseVersion(tag) ?? { major: 0, minor: 0, patch: 0, beta: null });
    expect(code('v1.2.0-beta.1')).toBeLessThan(code('v1.2.0-beta.2'));
    expect(code('v1.2.0-beta.2')).toBeLessThan(code('v1.2.0'));
    expect(code('v1.2.0')).toBeLessThan(code('v1.2.1-beta.1'));
    expect(code('v1.2.3')).toBe(1_020_399);
    expect(formatVersion({ major: 1, minor: 2, patch: 0, beta: 4 })).toBe('1.2.0-beta.4');
    expect(channelOf({ major: 1, minor: 0, patch: 0, beta: 1 })).toBe('beta');
  });

  it('offers the newest release for the channel', () => {
    const current = versionCode({ major: 1, minor: 0, patch: 0, beta: null });
    const pick = (
      channel: 'stable' | 'beta',
      stable: ReleaseInfo | null,
      beta: ReleaseInfo | null,
    ) => pickUpdate(current, channel, stable, beta, arm64Phone);
    expect(pick('stable', release('1.1.0'), release('1.2.0-beta.1'))?.version).toBe('1.1.0');
    expect(pick('beta', release('1.1.0'), release('1.2.0-beta.1'))?.version).toBe('1.2.0-beta.1');
    expect(pick('beta', release('1.2.0'), release('1.2.0-beta.3'))?.version).toBe('1.2.0');
    expect(pick('stable', release('1.0.0'), null)).toBeNull();
    expect(pick('stable', null, null)).toBeNull();
  });
});

describe('one APK per CPU type', () => {
  it('gives each CPU type its own versionCode above every earlier release', () => {
    const v = version('v0.1.0-beta.5');
    expect(abiVersionCode(v, 'armeabi-v7a')).toBe(100_051);
    expect(abiVersionCode(v, 'arm64-v8a')).toBe(100_052);
    // Single-APK releases before M54 used versionCode() directly: 0.1.0-beta.4 was 10004.
    expect(abiVersionCode(v, 'armeabi-v7a')).toBeGreaterThan(versionCode(version('v0.1.0-beta.4')));
    expect(abiVersionCode(version('v1.2.0'), 'armeabi-v7a')).toBeGreaterThan(
      abiVersionCode(version('v1.2.0-beta.3'), 'arm64-v8a'),
    );
    // Android's ceiling for versionCode.
    expect(abiVersionCode(version('v209.99.99'), 'arm64-v8a')).toBeLessThanOrEqual(2_100_000_000);
    expect(parseVersion('v210.0.0')).toBeNull();
  });

  it('keeps the plain file name for arm64', () => {
    const v = version('v1.2.0');
    expect(apkName(v, 'arm64-v8a')).toBe('lelap-1.2.0.apk');
    expect(apkName(v, 'armeabi-v7a')).toBe('lelap-1.2.0-armv7.apk');
    expect(apkName(v, 'arm64-v8a', 'fdroid')).toBe('lelap-1.2.0-fdroid.apk');
    expect(apkName(v, 'armeabi-v7a', 'fdroid')).toBe('lelap-1.2.0-fdroid-armv7.apk');
  });

  it('still reads release files from before M54', () => {
    const old = release('0.1.0-beta.4');
    expect(ReleaseInfo.parse(old)).toEqual(old);
    // Without a list of APKs the top-level one is offered, whatever the CPU.
    expect(pickUpdate(1, 'beta', null, old, arm32Phone)?.url).toBe(old.url);
  });

  it('points apps from before M54 at the arm64 APK', () => {
    // The schema those apps carry, which ignores fields it does not know.
    const OldReleaseInfo = z.object({
      version: z.string().min(1),
      versionCode: z.number().int().positive(),
      url: z.url(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      size: z.number().int().positive(),
      minSdk: z.number().int().positive().optional(),
      notes: z.string().optional(),
      publishedAt: z.string(),
    });
    const info = split('0.1.0-beta.5');
    const seen = OldReleaseInfo.parse(JSON.parse(JSON.stringify(info)));
    expect(seen.url).toBe('https://dl.example.org/apk/lelap-0.1.0-beta.5.apk');
    expect(seen.versionCode).toBe(100_052);
    expect(seen.versionCode).toBeGreaterThan(10_004);
  });

  it('offers each phone its own APK', () => {
    const info = split('0.1.0-beta.5');
    const on64 = pickUpdate(10_004, 'beta', null, info, arm64Phone);
    expect(on64?.url).toMatch(/lelap-0\.1\.0-beta\.5\.apk$/);
    expect(on64?.versionCode).toBe(100_052);
    expect(on64?.sha256).toBe('b'.repeat(64));
    const on32 = pickUpdate(10_004, 'beta', null, info, arm32Phone);
    expect(on32?.url).toMatch(/lelap-0\.1\.0-beta\.5-armv7\.apk$/);
    expect(on32?.versionCode).toBe(100_051);
    expect(on32?.size).toBe(29);
  });

  it('does not offer the same release again to a phone on the 32-bit APK', () => {
    const info = split('0.1.0-beta.5');
    expect(pickUpdate(100_051, 'beta', null, info, arm32Phone)).toBeNull();
    expect(pickUpdate(100_052, 'beta', null, info, arm64Phone)).toBeNull();
  });

  it('offers nothing to a device the release has no APK for', () => {
    const info = split('0.1.0-beta.5');
    expect(pickUpdate(10_004, 'beta', null, info, device('x86_64'))).toBeNull();
  });

  it('compares stable and beta by the APK this phone would get', () => {
    const stable = split('1.2.0');
    const beta = split('1.3.0-beta.1');
    expect(pickUpdate(1, 'beta', stable, beta, arm32Phone)?.version).toBe('1.3.0-beta.1');
    expect(pickUpdate(1, 'stable', stable, beta, arm32Phone)?.version).toBe('1.2.0');
  });
});

describe('JavaScript-only releases', () => {
  const published = (runtime?: string) => ({
    ...ReleaseInfo.parse({
      version: '0.2.0',
      versionCode: 200_992,
      url: 'https://dl.example.org/apk/lelap-0.2.0.apk',
      sha256: 'a'.repeat(64),
      size: 1,
      publishedAt: '2026-11-18T00:00:00.000Z',
    }),
    ...(runtime ? { runtime } : {}),
  });

  it('keeps the published APK when only JavaScript changed and the bundle went out', () => {
    expect(apkUpdateNeeded(published('abc'), 'abc', true)).toBe(false);
  });

  it('publishes the APK for a new native build', () => {
    expect(apkUpdateNeeded(published('abc'), 'def', true)).toBe(true);
  });

  it('publishes the APK when the over-the-air bundle did not go out', () => {
    expect(apkUpdateNeeded(published('abc'), 'abc', false)).toBe(true);
  });

  it('publishes the APK when there is nothing to compare with', () => {
    expect(apkUpdateNeeded(published(), 'abc', true)).toBe(true);
    expect(apkUpdateNeeded(null, 'abc', true)).toBe(true);
    expect(apkUpdateNeeded({ runtime: 'abc' }, 'abc', true)).toBe(true);
    expect(apkUpdateNeeded(published('abc'), '', true)).toBe(true);
  });

  it('lets apps from before the runtime field read the file', () => {
    expect(ReleaseInfo.safeParse(published('abc')).success).toBe(true);
  });
});
