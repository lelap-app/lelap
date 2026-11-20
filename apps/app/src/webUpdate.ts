// The app on a phone is updated over the air (`ota.ts`); only the web app has a service worker
// whose new build waits (`webUpdate.web.ts`).
export type WebUpdate = { reload: () => void; dismiss: () => void };

export const useWebUpdate = (): WebUpdate | null => null;
