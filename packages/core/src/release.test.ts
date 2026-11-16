import { describe, expect, it } from 'vitest';

import {
  channelOf,
  formatVersion,
  parseVersion,
  pickUpdate,
  type ReleaseInfo,
  versionCode,
} from './release';

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
    expect(pickUpdate(current, 'stable', release('1.1.0'), release('1.2.0-beta.1'))?.version).toBe(
      '1.1.0',
    );
    expect(pickUpdate(current, 'beta', release('1.1.0'), release('1.2.0-beta.1'))?.version).toBe(
      '1.2.0-beta.1',
    );
    expect(pickUpdate(current, 'beta', release('1.2.0'), release('1.2.0-beta.3'))?.version).toBe(
      '1.2.0',
    );
    expect(pickUpdate(current, 'stable', release('1.0.0'), null)).toBeNull();
    expect(pickUpdate(current, 'stable', null, null)).toBeNull();
  });
});
