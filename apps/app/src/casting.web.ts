import { t } from './i18n';
import type { CastDevice, CastSession, DiscoveryReport } from '@lelap/cast';

// The web app does not cast (yet); the player shows no Cast tool there.

export type { CastDevice, CastSession, DiscoveryReport };
export const addDiscoveryListener: (listener: (report: DiscoveryReport) => void) => {
  remove: () => void;
} = () => ({ remove: () => {} });
export const isLocalNetworkDenied: (error: unknown) => boolean = () => false;
export type Casting = {
  device: CastSession | null;
  volume: number | null;
  error: string | null;
  untrusted: boolean;
  notice: string | null;
};

export const CASTING_SUPPORTED = false;
const NONE: Casting = { device: null, volume: null, error: null, untrusted: false, notice: null };

export const useCasting = (): Casting => NONE;
export const startDiscovery = async (): Promise<void> => {};
export const stopDiscovery = async (): Promise<void> => {};
export const listDevices = async (): Promise<CastDevice[]> => [];
export const addDevicesListener: (listener: (devices: CastDevice[]) => void) => {
  remove: () => void;
} = () => ({ remove: () => {} });
export const startCasting: (devices: CastDevice[], book: unknown) => Promise<void> = async () => {
  throw new Error(t('Casting needs the Android app.'));
};
export const connectAnyway = async (): Promise<void> => {};
export const stopCasting = async (): Promise<void> => {};
export type LocalNetworkAccess = 'granted' | 'ask' | 'blocked';
export const localNetworkAccess = async (): Promise<LocalNetworkAccess> => 'granted';
export const requestLocalNetworkAccess = async (): Promise<LocalNetworkAccess> => 'granted';
export const setCastVolume: (level: number) => Promise<void> = async () => {};
