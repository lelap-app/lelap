// Android implementation; M6 adds audio.web.ts. While casting (M26), the controls go to the
// receiver: these named exports take the place of the module's own.
export * from '@lelap/audio';
export {
  addStateListener,
  getState,
  load,
  pause,
  play,
  seekBy,
  seekTo,
  setSettings,
  setSpeed,
  skip,
  skipToPart,
  unload,
} from '../casting';
