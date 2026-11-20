import type { RemoteSource } from '../schema';
import { basicAuth, type Fetch, fetchText, RemoteError } from './http';

/**
 * Home and away addresses (M146): a WebDAV, Jellyfin or Audiobookshelf server may also be
 * reachable at a second address, such as a LAN address at home and a public one outside. Books
 * are always named and stored by the server's own address; a request or stream is moved to the
 * address in use only as it starts, so one that is under way keeps its address.
 */
export type AddressedRemote = Extract<
  RemoteSource,
  { type: 'webdav' | 'jellyfin' | 'audiobookshelf' }
>;

export const takesSecondAddress = (
  remote: RemoteSource | null | undefined,
): remote is AddressedRemote =>
  remote?.type === 'webdav' || remote?.type === 'jellyfin' || remote?.type === 'audiobookshelf';

/** The server's addresses: its own first, then the one it is also reachable at, if any. */
export function serverAddresses(remote: RemoteSource | null | undefined): string[] {
  if (!takesSecondAddress(remote)) return [];
  const also = remote.alsoUrl?.trim();
  return also && base(also) !== base(remote.url) ? [remote.url, also] : [remote.url];
}

const base = (url: string) => url.trim().replace(/\/+$/, '');

// The same address as typed (Jellyfin and Audiobookshelf build on that) and as a URL parser
// writes it (WebDAV does): `HTTP://NAS:8080/My Books/` is `http://nas:8080/My%20Books`.
function forms(url: string): string[] {
  const raw = base(url);
  try {
    const parsed = base(new URL(raw).href);
    return parsed === raw ? [raw] : [raw, parsed];
  } catch {
    return [raw];
  }
}

/**
 * `uri` moved from address `from` to address `to`, keeping its path below the address and its
 * query; null when it is not below `from`.
 */
export function rebaseUri(uri: string, from: string, to: string): string | null {
  const toForms = forms(to);
  for (const prefix of forms(from)) {
    const rest = uri.slice(prefix.length);
    if (uri.startsWith(prefix) && (rest === '' || rest[0] === '/' || rest[0] === '?')) {
      // A URI as a parser writes it stays that way: a typed `My Books` would put a space in it.
      const parsed = prefix === forms(from).at(-1);
      return `${parsed ? toForms.at(-1) : toForms[0]}${rest}`;
    }
  }
  return null;
}

/** A server's own `uri` moved to `to`, one of its addresses; any other address as it is. */
export function atAddress(
  uri: string,
  remote: RemoteSource | null | undefined,
  to: string,
): string {
  const own = takesSecondAddress(remote) ? remote.url : null;
  if (!own || base(own) === base(to)) return uri;
  return rebaseUri(uri, own, to) ?? uri;
}

/** A connection error: no answer at all, or none in time. Any HTTP status is an answer. */
export const isConnectionError = (error: unknown) =>
  error instanceof RemoteError && (error.status === 0 || error.status === 408);

/**
 * Which address answered last, per server, until the network changes. Kept in memory only, so
 * each start begins with the server's own address (or whichever a probe finds first).
 */
export class AddressBook {
  private readonly chosen = new Map<string, string>();
  private readonly probing = new Map<string, Promise<unknown>>();
  private era = 0;

  /** The address to use for `key` now: the one that answered last, else the first. */
  current(key: string, addresses: string[]): string {
    const chosen = this.chosen.get(key);
    return chosen !== undefined && addresses.includes(chosen) ? chosen : (addresses[0] ?? '');
  }

  /** Counts network changes, so an answer that comes in after one is not kept. */
  get network(): number {
    return this.era;
  }

  /** Notes that `url` answered for `key`, unless the network changed since `network`. */
  answered(key: string, url: string, network = this.era): void {
    if (network === this.era) this.chosen.set(key, url);
  }

  /** The phone joined another network: every server's choice is made again. */
  networkChanged(): void {
    this.era++;
    this.chosen.clear();
    this.probing.clear();
  }

  /** Waits for a probe of `key` that is under way, so a request doesn't race it. */
  async settled(key: string): Promise<void> {
    await this.probing.get(key)?.catch(() => {});
  }

  /** @internal */
  track(key: string, probe: Promise<unknown>): void {
    this.probing.set(key, probe);
    void probe.finally(() => {
      if (this.probing.get(key) === probe) this.probing.delete(key);
    });
  }
}

/**
 * Runs `request` at the address that answered last; on a connection error, once at the other.
 * Only an address that answered with success is kept: an error may come from another device that
 * has the same LAN address on someone else's network.
 */
export async function tryAddresses<T>(
  book: AddressBook,
  key: string,
  addresses: string[],
  request: (address: string) => Promise<T>,
): Promise<T> {
  await book.settled(key);
  const network = book.network;
  const first = book.current(key, addresses);
  const attempt = async (address: string) => {
    const result = await request(address);
    book.answered(key, address, network);
    return result;
  };
  try {
    return await attempt(first);
  } catch (error) {
    const other = addresses.find((a) => a !== first);
    if (other === undefined || !isConnectionError(error)) throw error;
    try {
      return await attempt(other);
    } catch (second) {
      // Both silent: the first address's error, the one the user typed first.
      throw isConnectionError(second) ? error : second;
    }
  }
}

/**
 * Asks every address at once whether the server answers there, after a start or a network
 * change; the first that answers becomes the one in use. Requests for the server wait for it.
 * Returns that address, or null when none answered.
 */
export function probeAddresses(
  book: AddressBook,
  key: string,
  addresses: string[],
  answers: (address: string) => Promise<boolean>,
): Promise<string | null> {
  const network = book.network;
  const probe = new Promise<string | null>((resolve) => {
    let left = addresses.length;
    let won = false;
    if (left === 0) resolve(null);
    for (const address of addresses) {
      answers(address)
        .catch(() => false)
        .then((ok) => {
          left--;
          if (ok && !won) {
            // Only the first: a slower address that answers too decides nothing.
            won = true;
            book.answered(key, address, network);
            resolve(address);
          } else if (left === 0 && !won) resolve(null);
        });
    }
  });
  book.track(key, probe);
  return probe;
}

// Short: a probe that waits as long as a scan would leave the player on the silent address.
const PROBE_TIMEOUT_MS = 4_000;

/**
 * Whether the server answers at `address` as itself: Jellyfin's public system info,
 * Audiobookshelf's ping, the WebDAV folder listed with the login.
 * A captive portal or another device at the same LAN address on someone else's network does not.
 */
export async function answersAt(
  fetcher: Fetch,
  remote: AddressedRemote,
  address: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const at = base(address);
  if (remote.type === 'jellyfin') {
    const { response, text } = await fetchText(
      fetcher,
      `${at}/System/Info/Public`,
      { headers: { Accept: 'application/json' } },
      'Jellyfin server',
      timeoutMs,
    );
    return response.ok && hasKey(text, 'Id');
  }
  if (remote.type === 'audiobookshelf') {
    const { response, text } = await fetchText(
      fetcher,
      `${at}/ping`,
      { headers: { Accept: 'application/json' } },
      'Audiobookshelf server',
      timeoutMs,
    );
    return response.ok && hasKey(text, 'success');
  }
  const { response } = await fetchText(
    fetcher,
    `${at}/`,
    {
      method: 'PROPFIND',
      headers: { Authorization: basicAuth(remote.username, remote.password), Depth: '0' },
    },
    'WebDAV server',
    timeoutMs,
  );
  // With the login, only the server itself lists the folder; a router's 401 doesn't count.
  return response.status === 207;
}

function hasKey(text: string, key: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && key in parsed;
  } catch {
    return false;
  }
}
