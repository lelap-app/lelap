import type { CastDevice } from '@lelap/cast';

// The web app does not cast (yet); the player shows no Cast tool there.

export type { CastDevice };
export type Casting = { device: CastDevice | null; volume: number | null; error: string | null };

export const CASTING_SUPPORTED = false;
const NONE: Casting = { device: null, volume: null, error: null };

export const useCasting = (): Casting => NONE;
export const startDiscovery = async (): Promise<void> => {};
export const stopDiscovery = async (): Promise<void> => {};
export const listDevices = async (): Promise<CastDevice[]> => [];
export const addDevicesListener: (listener: (devices: CastDevice[]) => void) => {
  remove: () => void;
} = () => ({ remove: () => {} });
export const startCasting: (device: CastDevice, book: unknown) => Promise<void> = async () => {
  throw new Error('Casting needs the Android app.');
};
export const stopCasting = async (): Promise<void> => {};
export const setCastVolume: (level: number) => Promise<void> = async () => {};
