import { AddonError, type CatalogDefinition, type Manifest, type Meta } from '@lelap/sdk';

import type { ScrobbleAddon } from '../scrobble/mount';
import type { Upstream } from '../upstream';
import {
  type Account,
  type Instance,
  instanceUrl,
  readBook,
  readShelf,
  type Shelf,
  ShelfUnavailable,
  type ShelvedBook,
  SHELVES,
  userExists,
  userName,
} from './instance';
import { bookId, bookPath, PREFIX, previews } from './match';

// BookWyrm (M130): the listener's public reading shelves as catalog rows, read from their own
// instance. Only the instance address and user name ride in the sealed add-on URL; there is no
// password, and nothing is written to BookWyrm.

export const BASE_PATH = '/bookwyrm';

const NAMES: Record<Shelf, string> = {
  'to-read': 'Want to read on BookWyrm',
  reading: 'Currently reading on BookWyrm',
  read: 'Read on BookWyrm',
  'stopped-reading': 'Stopped reading on BookWyrm',
};

const CATALOGS: CatalogDefinition[] = SHELVES.map((shelf) => ({
  type: 'audiobook',
  id: shelf,
  name: NAMES[shelf],
  extra: [{ name: 'skip' }],
  // Home places it as it does Hardcover's Want to read.
  ...(shelf === 'to-read' ? { shelf: 'want-to-read' } : {}),
}));

export const bookwyrmManifest: Manifest = {
  id: 'app.lelap.bookwyrm',
  version: '1.0.0',
  protocol: 1,
  name: 'BookWyrm',
  description:
    'Shows your public BookWyrm shelves as rows: Want to read, Currently reading, Read and Stopped reading. Shelves from your own BookWyrm instance.',
  types: ['audiobook'],
  resources: ['catalog', { name: 'meta', idPrefixes: [PREFIX] }],
  idPrefixes: [PREFIX],
  catalogs: CATALOGS,
  configurable: true,
};

/** Settings from the SDK's config; null when they don't fit. */
export function reviveBookwyrm(value: unknown): Account | null {
  const v = value as { instance?: unknown; user?: unknown } | null;
  if (!v || typeof v.instance !== 'string' || typeof v.user !== 'string') return null;
  try {
    const instance = instanceUrl(v.instance);
    const user = userName(v.user, instance);
    return user ? { instance, user } : null;
  } catch {
    return null;
  }
}

const isShelf = (id: string): id is Shelf => (SHELVES as readonly string[]).includes(id);

/** The first shelf that can be read, to check the settings; throws what to fix. */
export async function checkAccount(instance: Instance, account: Account): Promise<void> {
  const host = new URL(account.instance).host;
  if (!(await userExists(instance, account)))
    throw new AddonError(400, `${host} has no user called ${account.user}.`);
  let refused = false;
  for (const shelf of SHELVES) {
    try {
      await readShelf(instance, account, shelf);
      return;
    } catch (error) {
      if (!(error instanceof ShelfUnavailable)) throw error;
      if (error.reason === 'refused') refused = true;
    }
  }
  throw new AddonError(
    400,
    refused
      ? `${host} turns away requests from outside apps, so your shelves can’t be read.`
      : `Your shelves on ${host} are private. Only public shelves can be shown: make them public in BookWyrm’s shelf settings, or make your profile public.`,
  );
}

/** A book that matched no work: what BookWyrm says about it, with a link to its page. */
async function bookMeta(instance: Instance, account: Account, id: string): Promise<Meta | null> {
  const found = bookPath(id);
  if (!found) return null;
  const own = found.host === new URL(account.instance).host.toLowerCase();
  let book: ShelvedBook | null = own ? await readBook(instance, account, found.path) : null;
  if (!book) {
    // Signed GET refuses the book's JSON, or the book is from another instance: the listener's
    // shelves, kept 15 minutes, still name it.
    for (const shelf of SHELVES) {
      try {
        const page = await readShelf(instance, account, shelf);
        book = page.books.find((b) => bookId(b) === id) ?? null;
      } catch {
        continue;
      }
      if (book) break;
    }
  }
  const link = `https://${found.host}${found.path}`;
  if (!book) return { id, type: 'audiobook', name: 'A book on BookWyrm', link };
  return {
    id,
    type: 'audiobook',
    name: book.title,
    ...(book.author ? { author: book.author } : {}),
    ...(book.cover ? { cover: book.cover } : {}),
    ...(book.description ? { description: book.description } : {}),
    ...(book.isbn ? { externalIds: { isbn: book.isbn } } : {}),
    link,
  };
}

export function bookwyrmAddon(instance: Instance, upstream: Upstream): ScrobbleAddon<Account> {
  return {
    basePath: BASE_PATH,
    manifest: bookwyrmManifest,
    text: {
      intro:
        'Enter your BookWyrm instance and user name. Lelap reads your public shelves and shows them as rows; it never asks for your password and writes nothing to BookWyrm. Private shelves can’t be shown.',
    },
    fields: [
      {
        key: 'instance',
        label: 'BookWyrm instance',
        // Text, so `bookwyrm.social` without https:// is accepted too.
        type: 'text',
        required: true,
        placeholder: 'https://bookwyrm.social',
      },
      {
        key: 'user',
        label: 'User name',
        type: 'text',
        required: true,
        placeholder: 'reader',
        help: 'As in your profile’s address, without the @.',
      },
    ],
    parse: (form) => {
      const instance = instanceUrl(typeof form.instance === 'string' ? form.instance : '');
      const user = userName(typeof form.user === 'string' ? form.user : '', instance);
      if (!user) throw new AddonError(400, 'Enter your user name, such as reader.');
      return { instance, user };
    },
    revive: reviveBookwyrm,
    store: (account) => ({ ...account }),
    check: (account) => checkAccount(instance, account),
    handlers: (account) => ({
      catalog: async ({ id, extra }) => {
        if (!isShelf(id)) throw new AddonError(404, 'Not found');
        const skip = Math.max(0, Number(extra.skip ?? 0) || 0);
        try {
          const page = await readShelf(instance, account, id, skip);
          return { metas: await previews(upstream, page.books), cacheMaxAge: 15 * 60 };
        } catch (error) {
          // A shelf made private since: an empty row, not an error screen.
          if (error instanceof ShelfUnavailable) return { metas: [], cacheMaxAge: 15 * 60 };
          // The instance is down or odd: an empty row for now, asked again soon.
          if (error instanceof AddonError && error.status >= 500)
            return { metas: [], cacheMaxAge: 60 };
          throw error;
        }
      },
      meta: async ({ id }) => {
        const meta = await bookMeta(instance, account, id);
        return meta ? { meta } : null;
      },
    }),
  };
}
