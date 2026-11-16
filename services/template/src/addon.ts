import { createAddon, type Manifest, type MetaPreview } from '@lelap/sdk';

import { BOOKS } from './books';

export const manifest: Manifest = {
  // Use a reverse-DNS ID of a domain you control.
  id: 'org.example.template',
  version: '1.0.0',
  protocol: 1,
  name: 'Template',
  description: 'A starting point for your own Lelap add-on.',
  types: ['audiobook'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['template:'],
  catalogs: [{ type: 'audiobook', id: 'books', name: 'Template books' }],
};

const preview = ({ id, type, name, author, cover, durationMs }: MetaPreview): MetaPreview => ({
  id,
  type,
  name,
  ...(author ? { author } : {}),
  ...(cover ? { cover } : {}),
  ...(durationMs ? { durationMs } : {}),
});

export const addon = createAddon({
  manifest,
  catalog: () => ({ metas: BOOKS.map((book) => preview(book.meta)), cacheMaxAge: 3600 }),
  meta: ({ id }) => {
    const book = BOOKS.find((b) => b.meta.id === id);
    return book ? { meta: book.meta, cacheMaxAge: 86400 } : null;
  },
  stream: ({ id }) => ({
    streams: BOOKS.filter((b) => b.meta.id === id).map((b) => b.stream),
    cacheMaxAge: 86400,
  }),
});
