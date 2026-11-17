import type { AudioDevice } from '@lelap/bluetooth';

// Browsers don't tell a page which headphones or car are connected, or their battery.
export type { AudioDevice };
export const BLUETOOTH = false;
export const permitted = (): boolean => false;
export const requestPermission = async (): Promise<boolean> => false;
export const start = async (): Promise<boolean> => false;
export const stop = async (): Promise<void> => {};
export const devices = (): AudioDevice[] => [];
export const addChangeListener = (listener: (devices: AudioDevice[]) => void) => {
  void listener;
  return { remove: () => {} };
};
