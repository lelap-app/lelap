// Android: SMB and SFTP through the netfs module (M62); netfs.web.ts says they are Android only.
export { check, copyTo, type HostKey, hostKey, list, NETFS_ERRORS } from '@lelap/netfs';

/** Whether this platform can open SMB and SFTP connections. */
export const NETFS = true;
