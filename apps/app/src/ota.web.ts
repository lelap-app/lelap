// The web app is updated by deploying it; there are no bundles to download.
export const OTA_UPDATES = false;

export type OtaResult = 'none' | 'downloaded' | 'error';

export const fetchOtaUpdate = (): Promise<OtaResult> => Promise.resolve('none');
export const otaDescription = (): string | null => null;
export const OtaRunner = (): null => null;
