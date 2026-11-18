import { requireNativeModule } from 'expo';

/** A file below the listed folder: `path` is relative to it, `/`-separated. */
export type NetfsEntry = { path: string; size: number; modifiedAt: number };

/** An SFTP server's key, as `ssh-keygen -l` prints it (`SHA256:…`), and its type. */
export type HostKey = { fingerprint: string; algorithm: string };

/**
 * Error codes the promises reject with. A changed host key and a refused login stay refused;
 * a timeout or an unreachable server may pass.
 */
export const NETFS_ERRORS = {
  login: 'ERR_NETFS_LOGIN',
  hostKeyChanged: 'ERR_NETFS_HOST_KEY_CHANGED',
  hostKeyUnknown: 'ERR_NETFS_HOST_KEY_UNKNOWN',
  privateKey: 'ERR_NETFS_PRIVATE_KEY',
  notFound: 'ERR_NETFS_NOT_FOUND',
  denied: 'ERR_NETFS_DENIED',
  address: 'ERR_NETFS_ADDRESS',
  timeout: 'ERR_NETFS_TIMEOUT',
  unreachable: 'ERR_NETFS_UNREACHABLE',
} as const;

type LelapNetfsModule = {
  hostKey(uri: string): Promise<HostKey>;
  check(uri: string, headers: Record<string, string>): Promise<{ folders: number; files: number }>;
  list(uri: string, headers: Record<string, string>): Promise<NetfsEntry[]>;
  copyTo(uri: string, headers: Record<string, string>, path: string): Promise<void>;
};

const native = requireNativeModule<LelapNetfsModule>('LelapNetfs');

/** Asks an SFTP server for its key and stops there: no login is sent. */
export function hostKey(uri: string): Promise<HostKey> {
  return native.hostKey(uri);
}

/** Reads only the folder at `uri`, to check the address and the login. */
export function check(
  uri: string,
  headers: Record<string, string>,
): Promise<{ folders: number; files: number }> {
  return native.check(uri, headers);
}

/** Every file below the folder at `uri`, up to 5,000 folders deep in all. */
export function list(uri: string, headers: Record<string, string>): Promise<NetfsEntry[]> {
  return native.list(uri, headers);
}

/** Copies one file, such as a folder's `cover.jpg`, to a path on the phone. */
export function copyTo(uri: string, headers: Record<string, string>, path: string): Promise<void> {
  return native.copyTo(uri, headers, path);
}
