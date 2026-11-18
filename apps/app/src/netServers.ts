import {
  type ListedFile,
  type NetfsSource,
  netfsHeaders,
  netfsListed,
  netRootUri,
} from '@lelap/core';

import { t } from './i18n';
import { list, NETFS_ERRORS } from './platform/netfs';

/** Every file below an SMB share's or SFTP server's folder, as a folder on the phone lists. */
export async function listNetServer(remote: NetfsSource): Promise<ListedFile[]> {
  return netfsListed(remote, await list(netRootUri(remote), netfsHeaders(remote)));
}

const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;

/** What went wrong with an SMB or SFTP server, in the listener's language. */
export function netServerReason(error: unknown): string {
  switch (codeOf(error)) {
    case NETFS_ERRORS.login:
      return t('The server refused the login. Check the username and password.');
    case NETFS_ERRORS.hostKeyChanged:
      return t(
        'The server’s host key changed, so Lelap did not connect. If you changed it yourself, remove the server in Settings and add it again.',
      );
    case NETFS_ERRORS.hostKeyUnknown:
      return t('The server’s host key is not trusted yet. Add the server again.');
    case NETFS_ERRORS.privateKey:
      return t('The private key can’t be read. Check its passphrase.');
    case NETFS_ERRORS.notFound:
      return t('That share or folder is not on the server.');
    case NETFS_ERRORS.denied:
      return t('The server does not let this login read that folder.');
    case NETFS_ERRORS.address:
      return t('The server address is not valid.');
    case NETFS_ERRORS.timeout:
      return t('The server did not answer within 30 s.');
    case NETFS_ERRORS.unreachable:
      return t(
        'No answer from the server. Check the address and that the phone is on its network.',
      );
    default:
      return error instanceof Error ? error.message : String(error);
  }
}
