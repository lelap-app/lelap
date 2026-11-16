import { NativeModule, requireNativeModule } from 'expo';

declare class LelapUpdaterModule extends NativeModule {
  versionCode(): number;
  canInstall(): boolean;
  lastError(): string | null;
  openInstallSettings(): Promise<void>;
  install(url: string, sha256: string, size: number): Promise<void>;
}

const native = requireNativeModule<LelapUpdaterModule>('LelapUpdater');

/** This build's Android versionCode. */
export const versionCode = (): number => native.versionCode();

/** Whether the user has let Lelap install updates (Android's “unknown apps” setting). */
export const canInstall = (): boolean => native.canInstall();

export const lastError = (): string | null => native.lastError();

export const openInstallSettings = (): Promise<void> => native.openInstallSettings();

/** Downloads the APK, checks it against the release's SHA-256 and size, then installs it. */
export const install = (url: string, sha256: string, size: number): Promise<void> =>
  native.install(url, sha256, size);
