import type { ListedFile } from '../library/scan';
import type { RemoteSource } from '../schema';

/** SMB and SFTP servers (M62): listed, read and played by the Android app's `netfs` module. */
export type NetfsSource = Extract<RemoteSource, { type: 'smb' | 'sftp' }>;
export type NetfsScheme = NetfsSource['type'];

/** What an SFTP login keeps sealed: a password, or a private key in OpenSSH or PEM form. */
export type SftpSecret = { password?: string; privateKey?: string; passphrase?: string };

/**
 * The header that carries an SMB or SFTP login to native code with a file's address, the way a
 * WebDAV login travels as `Authorization`. These addresses never go out over HTTP.
 */
export const NETFS_LOGIN_HEADER = 'X-Lelap-Netfs';

export const DEFAULT_PORT: Record<NetfsScheme, number> = { smb: 445, sftp: 22 };

/** A server folder: host (with `[…]` for IPv6), port when not the default, and path segments. */
export type NetAddress = {
  scheme: NetfsScheme;
  host: string;
  port: number | null;
  /** Decoded. For SMB the first one is the share. */
  segments: string[];
};

const ADDRESS =
  /^(smb|sftp):\/\/(?:[^/?#@]*@)?(\[[0-9A-Fa-f:.]+\]|[^/:?#[\]@]+)(?::(\d{1,5}))?(\/[^?#]*)?$/;

const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/**
 * Reads `smb://nas.local/Share/Audiobooks` or `sftp://host:2222/home/me/Books`. Spaces may be
 * typed as they are. A login in the address is dropped: it has fields of its own. Null when the
 * address is not one, or an SMB address names no share.
 */
export function parseNetAddress(url: string): NetAddress | null {
  const match = ADDRESS.exec(url.trim());
  if (!match) return null;
  const scheme = match[1] as NetfsScheme;
  const host = (match[2] ?? '').toLowerCase();
  const port = match[3] ? Number(match[3]) : null;
  if (port !== null && (port < 1 || port > 65_535)) return null;
  const segments = (match[4] ?? '')
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .map(decode);
  if (segments.some((s) => s === '..' || s.includes('/') || s.includes('\\'))) return null;
  if (scheme === 'smb' && segments.length === 0) return null;
  return { scheme, host, port: port === DEFAULT_PORT[scheme] ? null : port, segments };
}

const hostPort = (a: NetAddress) => (a.port === null ? a.host : `${a.host}:${a.port}`);

function addressOf(remote: NetfsSource): NetAddress {
  const address = parseNetAddress(remote.url);
  if (!address || address.scheme !== remote.type) {
    throw new Error(`Not an ${remote.type.toUpperCase()} address: ${remote.url}`);
  }
  return address;
}

/** The folder's address with each segment encoded, ending in `/`: `smb://nas.local/Share/My%20Books/`. */
export function netRootUri(remote: NetfsSource): string {
  const a = addressOf(remote);
  const path = a.segments.map(encodeURIComponent).join('/');
  return `${a.scheme}://${hostPort(a)}/${path}${path ? '/' : ''}`;
}

/** Host and folder, as Settings shows it: `nas.local/Share/My Books`. */
export function netName(remote: NetfsSource): string {
  const a = parseNetAddress(remote.url);
  if (!a) return remote.url;
  return [hostPort(a), ...a.segments].join('/');
}

/** Where the server's books live, the same on every device: `smb:nas.local/Share/My Books`. */
export const netRootLocation = (remote: NetfsSource) => `${remote.type}:${netName(remote)}`;

/** What the native side needs besides the address. The host key goes with an SFTP login. */
export function netfsLogin(remote: NetfsSource): Record<string, string> {
  if (remote.type === 'smb') return { username: remote.username, password: remote.password };
  const secret = sftpSecret(remote);
  return {
    username: remote.username,
    hostKey: remote.hostKey,
    ...(secret.password ? { password: secret.password } : {}),
    ...(secret.privateKey ? { privateKey: secret.privateKey } : {}),
    ...(secret.passphrase ? { passphrase: secret.passphrase } : {}),
  };
}

export const netfsHeaders = (remote: NetfsSource): Record<string, string> => ({
  [NETFS_LOGIN_HEADER]: JSON.stringify(netfsLogin(remote)),
});

/** The sealed part of an SFTP login, opened. Empty when this device can't open it. */
export function sftpSecret(remote: Extract<RemoteSource, { type: 'sftp' }>): SftpSecret {
  try {
    const parsed: unknown = JSON.parse(remote.secret);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: SftpSecret = {};
    for (const key of ['password', 'privateKey', 'passphrase'] as const) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'string' && value !== '') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export const sftpSecretJson = (secret: SftpSecret): string => JSON.stringify(secret);

/** A file as the native walk reports it, below the server folder. */
export type NetEntry = { path: string; size: number; modifiedAt: number };

/** The walk's files in the shape of a folder on the phone, so the same rules make books. */
export function netfsListed(remote: NetfsSource, entries: NetEntry[]): ListedFile[] {
  const root = netRootUri(remote);
  const location = netRootLocation(remote);
  const files: ListedFile[] = [];
  for (const entry of entries) {
    const parts = entry.path.split('/').filter((p) => p !== '');
    if (parts.length === 0 || parts.some((p) => p === '.' || p === '..')) continue;
    const relPath = parts.join('/');
    files.push({
      location: `${location}/${relPath}`,
      relPath,
      name: parts[parts.length - 1] ?? relPath,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
      uri: root + parts.map(encodeURIComponent).join('/'),
    });
  }
  return files;
}

export const isNetfsUri = (uri: string) => /^(smb|sftp):\/\//i.test(uri);
