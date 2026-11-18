// A browser can't open SMB or SFTP connections: it has no raw sockets. "Add a server" says so.

export type HostKey = { fingerprint: string; algorithm: string };
export type NetfsEntry = { path: string; size: number; modifiedAt: number };

export const NETFS = false;

export const NETFS_ERRORS = {
  login: 'ERR_NETFS_LOGIN',
  hostKeyChanged: 'ERR_NETFS_HOST_KEY_CHANGED',
  hostKeyUnknown: 'ERR_NETFS_HOST_KEY_UNKNOWN',
  privateKey: 'ERR_NETFS_PRIVATE_KEY',
  notFound: 'ERR_NETFS_NOT_FOUND',
  address: 'ERR_NETFS_ADDRESS',
  timeout: 'ERR_NETFS_TIMEOUT',
  unreachable: 'ERR_NETFS_UNREACHABLE',
} as const;

const unsupported = () =>
  Promise.reject(new Error('SMB and SFTP servers are only in the Android app.'));

export const hostKey = (): Promise<HostKey> => unsupported();
export const check = (): Promise<{ folders: number; files: number }> => unsupported();
export const list = (): Promise<NetfsEntry[]> => unsupported();
export const copyTo = (): Promise<void> => unsupported();
