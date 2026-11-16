// Hosts come from the environment so forks and self-hosters build the app for their own domain.
// `||`, not `??`: CI passes an unset repository variable as an empty string.
const domain: string = process.env.EXPO_PUBLIC_LELAP_DOMAIN || 'lelap.app';

/**
 * Add-ons installed on first start, as manifest URLs. `EXPO_PUBLIC_LELAP_ADDONS` (comma-separated)
 * replaces them, for example to point at `wrangler dev` on your laptop while developing.
 */
const configured: string =
  process.env.EXPO_PUBLIC_LELAP_ADDONS ||
  `https://catalog.${domain}/librivox/manifest.json,https://catalog.${domain}/manifest.json`;

export const defaultAddons: string[] = configured
  .split(',')
  .map((url: string) => url.trim())
  .filter((url: string) => url !== '');

/**
 * The feed and cover proxy for the web app (never audio). Browsers can't read most RSS feeds
 * across origins; the Android app fetches them directly.
 */
export const proxyBase: string = (
  process.env.EXPO_PUBLIC_LELAP_PROXY || `https://proxy.${domain}`
).replace(/\/$/, '');

/** The encrypted sync server. It stores sealed messages and never sees keys or plaintext. */
export const syncBase: string = (
  process.env.EXPO_PUBLIC_LELAP_SYNC || `https://sync.${domain}`
).replace(/\/$/, '');

/** Releases: `latest.json`, `beta.json` and the APKs. */
export const downloadsBase: string = (
  process.env.EXPO_PUBLIC_LELAP_DOWNLOADS || `https://dl.${domain}`
).replace(/\/$/, '');
