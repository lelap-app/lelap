// Android implementation; M6 adds downloads.web.ts.
export * from '@lelap/download';

/** Downloads wait for Wi-Fi or a charger when Settings say so. */
export const RULES_APPLY = true;

/** Android keeps downloads until they are removed; only the browser may clear its storage. */
export const keepStorage = (): Promise<boolean> => Promise.resolve(true);
export const storageKept = (): Promise<boolean> => Promise.resolve(true);
