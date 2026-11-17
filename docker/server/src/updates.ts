import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { createApp, type Storage } from '../../../services/updates/src/app';
import { port, serve } from './serve';

// The same layout as the downloads bucket: ota/channels/<channel>/<runtime>.json and the bundles.
const root = resolve(process.env.UPDATES_DIR ?? '/data');

async function read(key: string): Promise<Buffer | null> {
  const path = resolve(join(root, key));
  if (!path.startsWith(root + sep)) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

const folder: Storage = {
  text: async (key) => (await read(key))?.toString('utf8') ?? null,
  file: async (key) => {
    const bytes = await read(key);
    return bytes ? new Uint8Array(bytes) : null;
  },
};

serve(createApp(folder), port(8790), 'updates');
