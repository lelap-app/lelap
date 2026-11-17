import { describe, expect, it } from 'vitest';

import { buildManifest, fileName, updateIdFrom } from '../src/manifest';

const bundle = { sha256: 'aGFzaA', md5: '0123456789abcdef0123456789abcdef', ext: 'bundle' };
const icon = { sha256: 'aWNvbg', md5: 'fedcba9876543210fedcba9876543210', ext: 'PNG' };

describe('manifest', () => {
  it('names files by content and points at them', () => {
    const text = buildManifest({
      id: updateIdFrom('ab'.repeat(32)),
      createdAt: '2026-11-17T10:00:00.000Z',
      runtimeVersion: 'rt1',
      launchAsset: bundle,
      assets: [icon],
      baseUrl: 'https://dl.example.org/ota/rt1/u/',
      expoClient: { name: 'Lelap' },
    });
    const manifest = JSON.parse(text);
    expect(manifest.launchAsset).toEqual({
      hash: 'aGFzaA',
      key: bundle.md5,
      contentType: 'application/javascript',
      fileExtension: '.bundle',
      url: `https://dl.example.org/ota/rt1/u/${bundle.md5}.bundle`,
    });
    expect(manifest.assets[0].contentType).toBe('image/png');
    expect(fileName(icon)).toBe(`${icon.md5}.png`);
    expect(manifest.extra.expoClient.name).toBe('Lelap');
  });

  it('derives a stable version 4 style UUID from the content', () => {
    const id = updateIdFrom('ff'.repeat(32));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(updateIdFrom('ff'.repeat(32))).toBe(id);
    expect(updateIdFrom('ee'.repeat(32))).not.toBe(id);
  });

  it('signs the way expo-updates verifies: RSA-SHA256 over the manifest bytes', async () => {
    // A throwaway key for this test only; the real one lives in a CI secret.
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const { privateKey, publicKey } = (await crypto.subtle.generateKey(
      { ...algorithm, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
      false,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const text = buildManifest({
      id: updateIdFrom('cd'.repeat(32)),
      createdAt: '2026-11-17T10:00:00.000Z',
      runtimeVersion: 'rt1',
      launchAsset: bundle,
      assets: [],
      baseUrl: 'https://dl.example.org',
      expoClient: {},
    });
    const bytes = new TextEncoder().encode(text);
    const signature = await crypto.subtle.sign(algorithm, privateKey, bytes);
    expect(await crypto.subtle.verify(algorithm, publicKey, signature, bytes)).toBe(true);
  });
});
