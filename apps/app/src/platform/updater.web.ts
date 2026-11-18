// The web app is updated by deploying it; there is nothing to install.
export const SELF_UPDATES = false;
export const versionCode = (): number => 0;
export const canInstall = (): boolean => false;
export const lastError = (): string | null => null;
export const pickAbi = (): string | null => null;
export const openInstallSettings = async (): Promise<void> => {};
export const install = async (): Promise<void> => {};
