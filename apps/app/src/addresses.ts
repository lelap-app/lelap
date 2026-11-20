import {
  AddressBook,
  type AddressedRemote,
  answersAt,
  atAddress,
  listRoots,
  probeAddresses,
  type RemoteSource,
  serverAddresses,
  takesSecondAddress,
  tryAddresses,
} from '@lelap/core';
import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import { Platform } from 'react-native';

import { db } from './db';

// Home and away addresses (M146): which of a server's two addresses answered last, in memory
// only, so every start tries again. The rules are in `@lelap/core` (`remote/addresses.ts`).

const book = new AddressBook();
const send = (url: string, init?: RequestInit) => fetch(url, init);

type Server = { rootId: string; remote: AddressedRemote; addresses: string[] };

// Servers with two addresses, read again on every probe and when a server is saved, so a cover
// list doesn't read the roots for each cover.
let servers: Server[] | null = null;

function twoAddressServers(): Server[] {
  servers ??= listRoots(db).flatMap((root) => {
    const remote = root.remote;
    if (root.needsLogin || !takesSecondAddress(remote)) return [];
    const addresses = serverAddresses(remote);
    return addresses.length > 1 ? [{ rootId: root.id, remote, addresses }] : [];
  });
  return servers;
}

/** `uri`, one of the server's own, at the address in use for it now. */
export function atAddressInUse(
  rootId: string,
  remote: RemoteSource | null | undefined,
  uri: string,
): string {
  const addresses = serverAddresses(remote);
  if (addresses.length < 2) return uri;
  return atAddress(uri, remote, book.current(rootId, addresses));
}

/** A cover from a server with two addresses, at the address in use; anything else as it is. */
export function coverAtAddressInUse<T extends string | null | undefined>(url: T): T {
  if (!url) return url;
  // The longest own address first: `http://nas/jellyfin` is not `http://nas`'s.
  const longestFirst = [...twoAddressServers()].sort(
    (a, b) => b.remote.url.length - a.remote.url.length,
  );
  for (const server of longestFirst) {
    const moved = atAddressInUse(server.rootId, server.remote, url);
    if (moved !== url) return moved as T;
  }
  return url;
}

/**
 * Runs a request to a server at the address that answered last, and once at the other on a
 * connection error. `request` gets the server with that address as its `url`.
 */
export function atServer<R extends AddressedRemote, T>(
  rootId: string,
  remote: R,
  request: (atAddress: R) => Promise<T>,
): Promise<T> {
  const addresses = serverAddresses(remote);
  if (addresses.length < 2) return request(remote);
  return tryAddresses(book, rootId, addresses, (url) => request({ ...remote, url }));
}

/**
 * A stream from a server with two addresses failed: perhaps the phone left home without a new
 * network to notice, so that server is asked again, and the player follows if it moved.
 */
export function probeAfterError(rootId: string): void {
  const moved = watching;
  if (!moved || !twoAddressServers().some((s) => s.rootId === rootId)) return;
  void probeServers(moved, rootId).catch(() => {});
}

/** A server was added, changed or removed: its addresses are read again. */
export function serversChanged(): void {
  servers = null;
}

/**
 * A server's addresses were changed in Settings: it is asked again, and a book playing from it
 * follows, also when the address it streamed from was removed.
 */
export function addressesSaved(rootId: string): void {
  servers = null;
  const moved = watching;
  if (!moved) return;
  void probeServers(moved, rootId)
    .catch(() => {})
    .finally(() => moved(new Set([rootId])));
}

type Choices = Map<string, string>;

// What each server used before a network change, which clears the choices.
function choices(): Choices {
  return new Map(twoAddressServers().map((s) => [s.rootId, book.current(s.rootId, s.addresses)]));
}

type Moved = (rootIds: Set<string>) => void;

/**
 * Asks every server with two addresses where it answers; `moved` gets the servers whose address
 * in use changed. `only` limits it to one server, such as the one a stream just failed from.
 */
export async function probeServers(moved: Moved, only?: string, used?: Choices): Promise<void> {
  servers = null;
  const asked = twoAddressServers().filter((s) => only === undefined || s.rootId === only);
  const before = used ?? new Map(asked.map((s) => [s.rootId, book.current(s.rootId, s.addresses)]));
  await Promise.all(
    asked.map((s) =>
      probeAddresses(book, s.rootId, s.addresses, (address) => answersAt(send, s.remote, address)),
    ),
  );
  const changed = new Set(
    asked
      .filter((s) => book.current(s.rootId, s.addresses) !== before.get(s.rootId))
      .map((s) => s.rootId),
  );
  if (changed.size > 0) moved(changed);
}

let watching: Moved | null = null;

/**
 * At start and after every network change: forgets which addresses answered, asks again, and
 * tells `moved` about servers that answer elsewhere now, so the player can follow.
 */
export function watchServerAddresses(moved: Moved): void {
  if (watching) return;
  watching = moved;
  const changed = () => {
    const used = choices();
    book.networkChanged();
    void probeServers(moved, undefined, used).catch(() => {});
  };
  void probeServers(moved).catch(() => {});
  if (Platform.OS === 'web') {
    window.addEventListener('online', changed);
    return;
  }
  // The listener also reports changes that are not a new network; only a new state counts.
  let last: string | null = null;
  const note = (state: { type?: unknown; isConnected?: boolean | undefined }) => {
    const now = `${String(state.type)}|${String(state.isConnected)}`;
    if (last !== null && now !== last) changed();
    last = now;
  };
  void getNetworkStateAsync()
    .then(note)
    .catch(() => {});
  addNetworkStateListener(note);
}
