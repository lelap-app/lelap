// Step 2: settings. The SDK serves a form at /configure and puts what the listener chose into the
// add-on's URL; every handler gets it as `config`.
import { createAddon } from '@lelap/sdk';

import { BOOKS } from './books.mjs';
import { handlers as catalogHandlers, preview } from './catalog.mjs';

const HOUR_MS = 3_600_000;

export const configure = {
  fields: [
    { key: 'order', label: 'Order', type: 'select', options: ['Title', 'Year'], default: 'Title' },
    {
      key: 'short',
      label: 'Only books under an hour',
      type: 'checkbox',
      help: 'For a bedtime story.',
    },
  ],
};

// `config` is null until the listener saves the form: the defaults apply then.
function chosen(config) {
  let books = BOOKS.map((book) => book.meta);
  if (config?.short === true) books = books.filter((book) => book.durationMs < HOUR_MS);
  return config?.order === 'Year'
    ? books.toSorted((a, b) => a.year - b.year)
    : books.toSorted((a, b) => a.name.localeCompare(b.name));
}

export const handlers = {
  ...catalogHandlers,
  configure,
  catalog: ({ config }) => ({
    metas: chosen(config).map(preview),
    cacheMaxAge: 86_400,
  }),
};

export const addon = createAddon(handlers);
