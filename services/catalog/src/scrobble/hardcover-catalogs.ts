import { AddonError, type CatalogDefinition, type MetaPreview } from '@lelap/sdk';

import { TTL } from '../upstream';
import {
  BOOK_FIELDS,
  type Book,
  type GraphQL,
  HARDCOVER_SITE,
  preview,
  type TokenCache,
} from './hardcover-api';
import type { Field } from './mount';

// Catalogs from Hardcover (M76): trending books, featured lists, the listener's own lists, the
// lists they follow and public lists added by link. They run on the listener's own token only:
// Hardcover's terms let a public service use list data only for a user who allowed it.

export type Trending = 'month' | 'all';
export type ListRef = { id: number; name: string };

/** What the listener chose to see; missing in add-on links made before M76. */
export type Shown = { trending: Trending[]; lists: ListRef[] };

/** Links made before M76 get the trending rows and no lists. */
export const DEFAULT_SHOWN: Shown = { trending: ['month', 'all'], lists: [] };

/** Enough for a few rows; every list rides in the add-on link. */
export const MAX_LISTS = 12;
const NAME_LENGTH = 40;
/** Hardcover's cap per request for `books_trending`, and a fair page for a list. */
const PAGE = 100;

const TRENDING: Record<Trending, { id: string; name: string }> = {
  month: { id: 'trending-month', name: 'Trending this month on Hardcover' },
  all: { id: 'trending-all', name: 'Trending all time on Hardcover' },
};

/** The catalogs a listener's choice adds to the manifest, each credited to Hardcover. */
export function shownCatalogs(shown: Shown): CatalogDefinition[] {
  return [
    ...shown.trending.map((t) => ({ type: 'audiobook' as const, ...TRENDING[t] })),
    ...shown.lists.map((list) => ({
      type: 'audiobook' as const,
      id: `list-${list.id}`,
      name: `${list.name} on Hardcover`,
    })),
  ];
}

/** Settings as they come out of a sealed link; anything odd falls back to the defaults. */
export function reviveShown(value: unknown): Shown {
  const raw = value as { trending?: unknown; lists?: unknown } | null | undefined;
  if (!raw || typeof raw !== 'object') return DEFAULT_SHOWN;
  const trending = Array.isArray(raw.trending)
    ? raw.trending.filter((t): t is Trending => t === 'month' || t === 'all')
    : [];
  const lists = Array.isArray(raw.lists)
    ? raw.lists.flatMap((l: { id?: unknown; name?: unknown }) =>
        Number.isInteger(l?.id) && typeof l?.name === 'string'
          ? [{ id: l.id as number, name: l.name }]
          : [],
      )
    : [];
  return { trending, lists: lists.slice(0, MAX_LISTS) };
}

// `duration` is an enum, written into the query from the two values above.
const trendingIds = (duration: Trending) => `query Trending($limit: Int!) {
  books_trending(duration: ${duration}, limit: $limit, offset: 0) { ids error }
}`;

const BOOKS = `query Books($ids: [Int!]!) {
  books(where: { id: { _in: $ids } }, limit: ${PAGE}) { ${BOOK_FIELDS} }
}`;

const LIST_BOOKS = `query ListBooks($id: Int!) {
  lists(where: { id: { _eq: $id } }, limit: 1) {
    id name
    list_books(order_by: { position: asc }, limit: ${PAGE}) { position book { ${BOOK_FIELDS} } }
  }
}`;

// Three top-level fields: three of the ten a request may hold.
const LISTS = `query Lists($user: Int!) {
  mine: lists(where: { user_id: { _eq: $user } }, order_by: { updated_at: desc }, limit: 100) { id name }
  followed: followed_lists(where: { user_id: { _eq: $user } }, order_by: { created_at: desc }, limit: 100) { list { id name } }
  featured: lists(where: { featured: { _eq: true }, public: { _eq: true } }, order_by: { likes_count: desc }, limit: 50) { id name }
}`;

const LIST_BY_SLUG = `query ListBySlug($user: citext!, $slug: String!) {
  lists(where: { slug: { _eq: $slug }, user: { username: { _eq: $user } } }, limit: 1) { id name public user_id }
}`;

export type Available = { mine: ListRef[]; followed: ListRef[]; featured: ListRef[] };

export const NO_LISTS: Available = { mine: [], followed: [], featured: [] };

const trimmed = (list: { id: number; name?: string | null }): ListRef => {
  // By code point, so an emoji is never cut in half.
  const name = [...((list.name ?? '').trim() || `List ${list.id}`)];
  return {
    id: list.id,
    name: name.length > NAME_LENGTH ? `${name.slice(0, NAME_LENGTH - 1).join('')}…` : name.join(''),
  };
};

/** The lists a listener can pick from: their own, the ones they follow, Hardcover's featured. */
export async function availableLists(gql: GraphQL, user: number): Promise<Available> {
  const data = await gql<{
    mine: { id: number; name: string }[];
    followed: { list: { id: number; name: string } | null }[];
    featured: { id: number; name: string }[];
  }>(LISTS, { user });
  return {
    mine: data.mine.map(trimmed),
    followed: data.followed.flatMap((f) => (f.list ? [trimmed(f.list)] : [])),
    featured: data.featured.map(trimmed),
  };
}

/** `https://hardcover.app/@reader/lists/sci-fi` as `{ user, slug }`, or null. */
export function listLink(text: string): { user: string; slug: string } | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const site = new URL(HARDCOVER_SITE);
  if (url.hostname !== site.hostname && url.hostname !== `www.${site.hostname}`) return null;
  const match = /^\/@([^/]+)\/lists\/([^/]+)\/?$/.exec(url.pathname);
  if (!match?.[1] || !match[2]) return null;
  try {
    return { user: decodeURIComponent(match[1]), slug: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

/** A list by its link; it must be public or the listener's own. */
async function listByLink(gql: GraphQL, user: number, text: string): Promise<ListRef> {
  const link = listLink(text);
  if (!link) throw new AddonError(400, `“${text}” is not a link to a Hardcover list.`);
  const data = await gql<{
    lists: { id: number; name: string; public: boolean; user_id: number }[];
  }>(LIST_BY_SLUG, link);
  const list = data.lists[0];
  if (!list || (!list.public && list.user_id !== user))
    throw new AddonError(400, `Hardcover has no public list at ${text}.`);
  return trimmed(list);
}

const idOf = (list: ListRef) => String(list.id);

/** The second settings page: which trending rows and lists to show. */
export function pickFields(
  available: Available,
  shown: Shown | undefined,
  canReadLists = true,
): Field[] {
  const chosen = new Set((shown?.lists ?? []).map(idOf));
  // A new link starts with the listener's own lists ticked, up to the limit.
  const ownByDefault = new Set(available.mine.slice(0, MAX_LISTS).map(idOf));
  const ticked = (list: ListRef) => (shown ? chosen.has(idOf(list)) : ownByDefault.has(idOf(list)));
  const known = new Set(
    [...available.mine, ...available.followed, ...available.featured].map(idOf),
  );
  const byLink = (shown?.lists ?? []).filter((l) => !known.has(idOf(l)));
  const group = (label: string, lists: ListRef[], hint?: string): Field => ({
    name: 'list',
    label,
    type: 'checkbox',
    required: false,
    ...(hint ? { hint } : {}),
    options: lists.map((l) => ({ value: idOf(l), label: l.name, checked: ticked(l) })),
  });
  const trending = shown?.trending ?? DEFAULT_SHOWN.trending;
  const fields: Field[] = [
    {
      name: 'trending',
      label: 'Trending on Hardcover',
      type: 'checkbox',
      required: false,
      ...(canReadLists
        ? {}
        : {
            hint: 'Your token lacks read:lists, so lists can’t be shown. Make one with it to add them.',
          }),
      options: [
        { value: 'month', label: 'This month', checked: trending.includes('month') },
        { value: 'all', label: 'All time', checked: trending.includes('all') },
      ],
    },
    group('Your lists', available.mine),
    group('Lists you follow', available.followed),
    group('Featured on Hardcover', available.featured),
    group('Added by link', byLink),
    {
      name: 'links',
      label: 'Add lists by link',
      type: 'text',
      required: false,
      placeholder: `${HARDCOVER_SITE}/@someone/lists/some-list`,
      hint: `Public lists, or your own. Separate several with spaces. Up to ${MAX_LISTS} lists in all.`,
    },
  ];
  return fields.filter(
    (f) =>
      (f.type !== 'checkbox' || (f.options?.length ?? 0) > 0) &&
      (canReadLists || f.name !== 'links'),
  );
}

/** The listener's picks as settings; throws an `AddonError` (400) with what to fix. */
export async function applyPicks(
  gql: GraphQL,
  user: number,
  available: Available,
  form: (name: string) => string[],
  previous: Shown | undefined,
): Promise<Shown> {
  const trending = (['month', 'all'] as const).filter((t) => form('trending').includes(t));
  const ticked = new Set(form('list'));
  const offered = [
    ...available.mine,
    ...available.followed,
    ...available.featured,
    ...(previous?.lists ?? []),
  ];
  const lists = new Map<number, ListRef>();
  for (const list of offered) if (ticked.has(idOf(list))) lists.set(list.id, list);
  const links = form('links')
    .flatMap((value) => value.split(/[\s,]+/))
    .filter(Boolean);
  if (lists.size + links.length > MAX_LISTS)
    throw new AddonError(400, `Pick up to ${MAX_LISTS} lists.`);
  for (const link of links) {
    const list = await listByLink(gql, user, link);
    lists.set(list.id, list);
  }
  return { trending, lists: [...lists.values()] };
}

/** How long answers are kept per token: hours, since each request counts against its limit. */
export const CATALOG_TTL = { trending: TTL.catalog, list: 2 * 60 * 60 } as const;

/** Trending books in Hardcover's own order. Two requests: the ranked IDs, then the books. */
export async function trendingBooks(gql: GraphQL, duration: Trending): Promise<MetaPreview[]> {
  const ranked = await gql<{ books_trending: { ids?: number[] | null; error?: string | null } }>(
    trendingIds(duration),
    { limit: PAGE },
  );
  const ids = (ranked.books_trending.ids ?? []).slice(0, PAGE);
  if (ranked.books_trending.error && ids.length === 0)
    throw new AddonError(502, `Hardcover: ${ranked.books_trending.error}`);
  if (ids.length === 0) return [];
  const data = await gql<{ books: Book[] }>(BOOKS, { ids });
  const byId = new Map(data.books.map((b) => [b.id, b]));
  return ids.flatMap((id) => {
    const book = byId.get(id);
    return book ? [preview(book)] : [];
  });
}

/** The books on one list, in the list's own order. */
export async function listBooks(gql: GraphQL, id: number): Promise<MetaPreview[]> {
  const data = await gql<{
    lists: { list_books: { position?: number | null; book: Book | null }[] }[];
  }>(LIST_BOOKS, { id });
  const list = data.lists[0];
  // Gone, or no longer public: Hardcover answers no rows.
  if (!list) return [];
  const seen = new Set<number>();
  return [...list.list_books]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .flatMap((row) => {
      if (!row.book || seen.has(row.book.id)) return [];
      seen.add(row.book.id);
      return [preview(row.book)];
    });
}

/** Answers one of the catalogs above, or null for a catalog ID that is not one of them. */
export function catalogFor(
  id: string,
  gql: GraphQL,
  cached: TokenCache,
): Promise<{ metas: MetaPreview[]; cacheMaxAge: number }> | null {
  const trending = (Object.keys(TRENDING) as Trending[]).find((t) => TRENDING[t].id === id);
  if (trending)
    return cached(`trending:${trending}`, CATALOG_TTL.trending, () =>
      trendingBooks(gql, trending),
    ).then((metas) => ({ metas, cacheMaxAge: 3600 }));
  const list = /^list-(\d+)$/.exec(id)?.[1];
  if (list)
    return cached(`list:${list}`, CATALOG_TTL.list, () => listBooks(gql, Number(list))).then(
      // Private to this listener: never in a shared cache.
      (metas) => ({ metas, cacheMaxAge: 0 }),
    );
  return null;
}
