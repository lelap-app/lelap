// Android implementation; M6 adds library.web.ts.
export {
  FOLDER_UNAVAILABLE,
  hasPermission,
  listTree,
  pickFolder,
  readImage,
  readTags,
} from '@lelap/library';

/** Whether this platform can read a local library folder. */
export const LOCAL_FOLDERS = true;
