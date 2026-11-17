import { describe, expect, it } from 'vitest';

import { createApp, type Storage } from '../src/app';
import { manifestId, parsePublished, publishedKey } from '../src/published';

const RUNTIME = 'a1b2c3d4e5f6';
const MANIFEST = JSON.stringify({
  id: '0d4c7a52-7d1c-4a3e-9a51-0b3c2f6a9e10',
  createdAt: '2026-11-17T10:00:00.000Z',
  runtimeVersion: RUNTIME,
  launchAsset: { key: 'abc', contentType: 'application/javascript', url: 'https://x/a.bundle' },
  assets: [],
  metadata: {},
  extra: {},
});
const PUBLISHED = JSON.stringify({ manifest: MANIFEST, signature: 'c2lnbmF0dXJl', keyId: 'main' });

function setup(files: Record<string, string>) {
  const storage: Storage = {
    text: (key) => Promise.resolve(files[key] ?? null),
    file: (key) =>
      Promise.resolve(
        key in files ? new Uint8Array(new TextEncoder().encode(files[key] ?? '')) : null,
      ),
  };
  const app = createApp(storage);
  return (path: string, headers: Record<string, string> = {}) =>
    app.request(`https://updates.example.org${path}`, { headers });
}

const ask = (extra: Record<string, string> = {}) => ({
  'expo-protocol-version': '1',
  'expo-platform': 'android',
  'expo-runtime-version': RUNTIME,
  ...extra,
});

/** Splits a multipart/mixed body into its parts' headers and bodies. */
function parts(body: string, contentType: string) {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? '';
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((raw) => {
      const [head = '', content = ''] = raw.replace(/^\r\n/, '').split('\r\n\r\n');
      const headers = Object.fromEntries(
        head.split('\r\n').map((line) => {
          const i = line.indexOf(':');
          return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()];
        }),
      );
      return { headers, body: content.replace(/\r\n$/, '') };
    });
}

describe('manifest endpoint', () => {
  it('answers with the signed manifest as a multipart response', async () => {
    const get = setup({ [publishedKey('production', RUNTIME)]: PUBLISHED });
    const response = await get('/manifest', ask());
    expect(response.status).toBe(200);
    expect(response.headers.get('expo-protocol-version')).toBe('1');
    expect(response.headers.get('cache-control')).toBe('private, max-age=0');
    const type = response.headers.get('content-type') ?? '';
    expect(type).toMatch(/^multipart\/mixed; boundary=/);

    const [manifest, extensions] = parts(await response.text(), type);
    expect(manifest?.headers['content-disposition']).toBe('inline; name="manifest"');
    // Byte for byte what was signed.
    expect(manifest?.body).toBe(MANIFEST);
    expect(manifest?.headers['expo-signature']).toBe(
      'sig="c2lnbmF0dXJl", keyid="main", alg="rsa-v1_5-sha256"',
    );
    expect(extensions?.headers['content-disposition']).toBe('inline; name="extensions"');
  });

  it('reads the beta channel separately', async () => {
    const get = setup({ [publishedKey('beta', RUNTIME)]: PUBLISHED });
    expect((await get('/manifest', ask())).status).toBe(204);
    expect((await get('/manifest', ask({ 'expo-channel-name': 'beta' }))).status).toBe(200);
  });

  it('says there is nothing new with 204', async () => {
    const get = setup({ [publishedKey('production', RUNTIME)]: PUBLISHED });
    const none = await get('/manifest', ask({ 'expo-runtime-version': 'other' }));
    expect(none.status).toBe(204);
    expect(none.headers.get('expo-protocol-version')).toBe('1');
    const current = await get(
      '/manifest',
      ask({ 'expo-current-update-id': '0D4C7A52-7D1C-4A3E-9A51-0B3C2F6A9E10' }),
    );
    expect(current.status).toBe(204);
  });

  it('refuses requests it cannot answer safely', async () => {
    const get = setup({});
    expect((await get('/manifest', ask({ 'expo-protocol-version': '0' }))).status).toBe(406);
    expect((await get('/manifest', ask({ 'expo-platform': 'ios' }))).status).toBe(400);
    expect((await get('/manifest', ask({ 'expo-runtime-version': '../x' }))).status).toBe(400);
    expect((await get('/manifest', ask({ 'expo-channel-name': 'nightly' }))).status).toBe(400);
  });

  it('treats a damaged record as no update', async () => {
    const get = setup({ [publishedKey('production', RUNTIME)]: '{"manifest":1}' });
    expect((await get('/manifest', ask())).status).toBe(204);
  });
});

describe('bundle files', () => {
  it('serves update files with immutable caching', async () => {
    const get = setup({ [`ota/${RUNTIME}/u1/abc.bundle`]: 'code' });
    const response = await get(`/ota/${RUNTIME}/u1/abc.bundle`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/javascript');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(await response.text()).toBe('code');
  });

  it('serves nothing else', async () => {
    const get = setup({
      [publishedKey('production', RUNTIME)]: PUBLISHED,
      'ota/x/song.mp3': 'audio',
    });
    expect((await get(`/ota/channels/production/${RUNTIME}.json`)).status).toBe(404);
    expect((await get('/ota/x/song.mp3')).status).toBe(404);
    expect((await get('/ota/%2e%2e/latest.json')).status).toBe(404);
  });
});

describe('published records', () => {
  it('parses what CI writes and rejects the rest', () => {
    expect(parsePublished(PUBLISHED)?.keyId).toBe('main');
    expect(parsePublished('not json')).toBeNull();
    expect(parsePublished(JSON.stringify({ manifest: 'm', signature: 'x"y', keyId: 'main' }))).toBe(
      null,
    );
    expect(manifestId(MANIFEST)).toBe('0d4c7a52-7d1c-4a3e-9a51-0b3c2f6a9e10');
  });
});
