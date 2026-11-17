import { Hono } from 'hono';

import { CONTENT_TYPES } from './manifest';
import { CHANNELS, manifestId, parsePublished, publishedKey, SAFE_NAME } from './published';

/** Read-only access to the downloads bucket (R2 on Workers, a folder on Node). */
export type Storage = {
  text: (key: string) => Promise<string | null>;
  file: (key: string) => Promise<ReadableStream | Uint8Array<ArrayBuffer> | null>;
};

const PROTOCOL_HEADERS = {
  'expo-protocol-version': '1',
  'expo-sfv-version': '0',
  // Every device asks with its own headers; nothing in between may answer for another.
  'cache-control': 'private, max-age=0',
} as const;

function part(name: string, body: string, headers: Record<string, string> = {}): string {
  const lines = [
    `content-disposition: inline; name="${name}"`,
    'content-type: application/json; charset=utf-8',
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
  ];
  return `${lines.join('\r\n')}\r\n\r\n${body}\r\n`;
}

export function createApp(storage: Storage): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json({ service: 'lelap-updates', protocol: 1 }));

  // The Expo Updates protocol, version 1: https://docs.expo.dev/technical-specs/expo-updates-1/
  app.get('/manifest', async (c) => {
    const platform = c.req.header('expo-platform') ?? c.req.query('platform');
    const runtimeVersion = c.req.header('expo-runtime-version') ?? c.req.query('runtime-version');
    const channel = c.req.header('expo-channel-name') ?? 'production';
    const protocol = Number(c.req.header('expo-protocol-version') ?? '0');

    if (protocol !== 1) return c.json({ error: 'Only protocol version 1 is served.' }, 406);
    if (platform !== 'android') return c.json({ error: 'Only Android has updates.' }, 400);
    if (!runtimeVersion || !SAFE_NAME.test(runtimeVersion)) {
      return c.json({ error: 'Missing or invalid expo-runtime-version.' }, 400);
    }
    if (!(CHANNELS as readonly string[]).includes(channel)) {
      return c.json({ error: 'Unknown channel.' }, 400);
    }

    const text = await storage.text(publishedKey(channel, runtimeVersion));
    const published = text === null ? null : parsePublished(text);
    // 204 tells protocol 1 clients there is nothing to load; no signature needed for that.
    if (!published) return c.body(null, 204, PROTOCOL_HEADERS);
    const current = c.req.header('expo-current-update-id');
    if (current && current.toLowerCase() === manifestId(published.manifest)?.toLowerCase()) {
      return c.body(null, 204, PROTOCOL_HEADERS);
    }

    const signature = `sig="${published.signature}", keyid="${published.keyId}", alg="rsa-v1_5-sha256"`;
    const boundary = `lelap-${crypto.randomUUID()}`;
    const body =
      `--${boundary}\r\n` +
      part('manifest', published.manifest, { 'expo-signature': signature }) +
      `--${boundary}\r\n` +
      part('extensions', JSON.stringify({ assetRequestHeaders: {} })) +
      `--${boundary}--\r\n`;
    return c.body(body, 200, {
      ...PROTOCOL_HEADERS,
      'content-type': `multipart/mixed; boundary=${boundary}`,
    });
  });

  // Bundles and assets, by the paths the manifests name. Never audio: only the types above.
  app.get('/ota/*', async (c) => {
    const key = decodeURIComponent(new URL(c.req.url).pathname.slice(1));
    const segments = key.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..' || !SAFE_NAME.test(s))) {
      return c.json({ error: 'Not found.' }, 404);
    }
    const type = CONTENT_TYPES[key.split('.').pop()?.toLowerCase() ?? ''];
    if (!type || segments[1] === 'channels') return c.json({ error: 'Not found.' }, 404);
    const file = await storage.file(key);
    if (!file) return c.json({ error: 'Not found.' }, 404);
    return c.body(file, 200, {
      'content-type': type,
      // A published update never changes: each one has its own folder.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
  });

  return app;
}
