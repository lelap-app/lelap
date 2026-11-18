import type { RemoteSource } from '../schema';

// Android 17 asks for local network access at run time, also from apps that target 36, and
// without it every connection to the home network fails. These rules say which servers need it
// and what the app does about it; asking and checking are the cast module's (`LocalNetwork.kt`).

/** `granted`, `ask` (explain, then Android's prompt) or `blocked` (only Android's settings can). */
export type LocalNetworkAccess = 'granted' | 'ask' | 'blocked';

// Names that never resolve on the internet: mDNS (`.local`), RFC 8375's `home.arpa`, and the
// suffixes routers hand out for their own network.
const LOCAL_SUFFIXES = ['.local', '.localhost', '.home.arpa', '.lan', '.internal'];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Octets(host: string): number[] | null {
  const match = IPV4.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function isLocalIpv4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return false;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** The 8 groups of an IPv6 address as numbers, or null when it is not one. */
function ipv6Groups(host: string): number[] | null {
  if (!host.includes(':')) return null;
  let text = host.split('%')[0] ?? '';
  // An IPv4 tail, as in `::ffff:192.168.1.2`, becomes two groups.
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const octets = ipv4Octets(tail[2] ?? '');
    if (!octets) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isLocalIpv6(groups: number[]): boolean {
  const [first = 0] = groups;
  // ::1
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
  // Unique local fc00::/7 and link-local fe80::/10.
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
  // IPv4-mapped ::ffff:a.b.c.d follows the IPv4 rule.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [, , , , , , hi = 0, lo = 0] = groups;
    return isLocalIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  return false;
}

/**
 * Whether a host name or IP address is on the local network: private IPv4 (10/8, 172.16/12,
 * 192.168/16), link-local (169.254/16, fe80::/10), loopback, IPv6 unique local (fc00::/7),
 * `.local` and other names that never resolve on the internet, and bare names without a dot. A
 * public name that the home router resolves to a private address can't be told apart here.
 */
export function isLocalHost(host: string): boolean {
  let name = host.trim().toLowerCase();
  if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1);
  if (name.endsWith('.')) name = name.slice(0, -1);
  if (name === '') return false;
  const v4 = ipv4Octets(name);
  if (v4) return isLocalIpv4(v4);
  const v6 = ipv6Groups(name);
  if (v6) return isLocalIpv6(v6);
  if (name.includes(':')) return false;
  if (name === 'localhost' || LOCAL_SUFFIXES.some((s) => name.endsWith(s))) return true;
  // A bare name (`nas`) is resolved by the router or the phone's search domain.
  return !name.includes('.');
}

const WITH_SCHEME = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i;
const BARE = /^(\[[^\]]*\]|[^:/?#\s]*)/;

/** The host of an address with any scheme (`https://`, `smb://`, `sftp://`) or none (`nas:8080`). */
export function hostOf(address: string): string | null {
  const text = address.trim();
  if (text === '') return null;
  if (!text.includes('://') && ipv6Groups(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !text.includes('://')) {
    // `nas:8080` has a port, not a scheme; `file:`, `content:` and `blob:` have no host.
    if (!/^[^:]+:\d+(?:[/?#]|$)/.test(text)) return null;
  }
  const match = text.includes('://') ? WITH_SCHEME.exec(text) : BARE.exec(text);
  const host = match?.[1] ?? '';
  return host === '' ? null : host;
}

/** Whether an address, with or without a scheme, points at the local network. */
export function isLocalAddress(address: string): boolean {
  const host = hostOf(address);
  return host !== null && isLocalHost(host);
}

/**
 * The addresses a server is reached at. An add-on's come from its manifest and its form
 * (`addonSourceHosts`), which only the app can read, so they are passed in.
 */
export function remoteAddresses(remote: RemoteSource, addonHosts: string[] = []): string[] {
  switch (remote.type) {
    case 's3':
      return [remote.endpoint];
    case 'addon':
      return addonHosts;
    default:
      return [remote.url];
  }
}

/** Whether any of a server's addresses is on the local network. */
export function isLocalRemote(remote: RemoteSource, addonHosts: string[] = []): boolean {
  return remoteAddresses(remote, addonHosts).some(isLocalAddress);
}

/**
 * What to do before the listener adds, tests, scans, plays or downloads from a server: `go`,
 * `explain` (say why, then show Android's prompt) or `settings` (only Android's settings can turn
 * it on). `local` is whether the server is on the local network.
 */
export function localNetworkStep(
  local: boolean,
  access: LocalNetworkAccess,
): 'go' | 'explain' | 'settings' {
  if (!local || access === 'granted') return 'go';
  return access === 'ask' ? 'explain' : 'settings';
}

/**
 * Whether a scan that runs by itself may try a server. A local server without access is skipped
 * and marked, so Settings can ask; asking in the middle of a background scan would surprise.
 */
export function scanNeedsAccess(local: boolean, access: LocalNetworkAccess): boolean {
  return localNetworkStep(local, access) !== 'go';
}

/**
 * Why a connection may have failed: `certain` when the server is on the local network and access
 * is off, `possible` when access is off and a public name may still lead home, `none` otherwise.
 */
export function localNetworkCause(
  local: boolean,
  access: LocalNetworkAccess,
): 'certain' | 'possible' | 'none' {
  if (access === 'granted') return 'none';
  return local ? 'certain' : 'possible';
}
