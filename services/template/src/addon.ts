import { createAddon, type Manifest, type MetaPreview } from '@lelap/sdk';

import { BOOKS } from './books';

export const manifest: Manifest = {
  // Use a reverse-DNS ID of a domain you control.
  id: 'org.example.template',
  version: '1.0.0',
  protocol: 1,
  protocolVersion: 2,
  name: 'Template',
  description: 'A starting point for your own Lelap add-on.',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['template:'],
  catalogs: [{ type: 'audiobook', id: 'books', name: 'Template books' }],
};

const preview = ({
  id,
  type,
  name,
  author,
  cover,
  year,
  durationMs,
}: MetaPreview): MetaPreview => ({
  id,
  type,
  name,
  ...(author ? { author } : {}),
  ...(cover ? { cover } : {}),
  ...(year ? { year } : {}),
  ...(durationMs ? { durationMs } : {}),
});

const ORDERS = ['Title', 'Year'];

export const addon = createAddon({
  manifest,
  // A settings page at /configure. The choice travels in the add-on's URL (`/p1.…/manifest.json`),
  // so nothing is stored. For passwords or API keys, add `password` fields and a `secret` from your
  // environment, which encrypts the URL; `check` can sign in with them before the URL is made.
  configure: {
    fields: [{ key: 'order', label: 'Sort books by', type: 'select', options: ORDERS }],
  },
  catalog: ({ config }) => {
    const books = BOOKS.map((book) => preview(book.meta));
    if (config?.order === 'Year') books.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
    if (config?.order === 'Title') books.sort((a, b) => a.name.localeCompare(b.name));
    return { metas: books, cacheMaxAge: 3600 };
  },
  meta: ({ id }) => {
    const book = BOOKS.find((b) => b.meta.id === id);
    return book ? { meta: book.meta, cacheMaxAge: 86400 } : null;
  },
  stream: ({ id }) => ({
    streams: BOOKS.filter((b) => b.meta.id === id).map((b) => b.stream),
    cacheMaxAge: 86400,
  }),
  // /health: say whether your source answers. Keep it quick; the app asks when Settings opens.
  health: () => ({ status: 'ok' }),
});
