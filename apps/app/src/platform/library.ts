// Android implementation; M6 adds library.web.ts.
export {
  FOLDER_UNAVAILABLE,
  findSilences,
  hasPermission,
  listTree,
  pickFolder,
  readImage,
  readRemoteTags,
  readTags,
  removeSilences,
  silenceStatuses,
  type SilenceStatus,
} from '@lelap/library';

/** Whether this platform can read a local library folder. */
export const LOCAL_FOLDERS = true;

/** Whether this platform can find chapters from silences (M45). */
export const SILENCE_SCAN = true;
