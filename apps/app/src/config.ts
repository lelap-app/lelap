// Hosts come from the environment so forks and self-hosters build the app for their own domain.

/**
 * `fdroid` for the build F-Droid ships: no APK self-updates and no over-the-air bundles, since
 * F-Droid delivers the updates. Anything else is the direct download from our own site.
 */
export const distribution: 'direct' | 'fdroid' =
  process.env.EXPO_PUBLIC_LELAP_DISTRIBUTION === 'fdroid' ? 'fdroid' : 'direct';

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
 * Our own add-ons that need the listener's account, so they are never installed by default: the
 * Add-ons screen offers them, and "Set up" opens their configure page on the catalog host.
 */
export const hostedAddons: { id: 'hardcover' | 'gpodder'; base: string }[] = [
  { id: 'hardcover', base: `https://catalog.${domain}/hardcover` },
  { id: 'gpodder', base: `https://catalog.${domain}/gpodder` },
];

const ownOrigins = new Set(
  [...defaultAddons, ...hostedAddons.map((h) => h.base)].flatMap((url) => {
    try {
      return [new URL(url).origin];
    } catch {
      return [];
    }
  }),
);

/** Whether an add-on is one of Lelap's own, served from our catalog host (or the configured ones). */
export function isOwnAddon(url: string): boolean {
  try {
    return ownOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

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

/** Where Lelap's source lives; it names the app to services the add-ons inside it talk to. */
export const sourceUrl: string =
  process.env.EXPO_PUBLIC_LELAP_SOURCE_URL || 'https://github.com/lelap-app/lelap';

/** The User-Agent scrobblers inside the app send where a User-Agent can be set (not in a browser). */
export const clientName = `Lelap/1 (+${sourceUrl})`;

/**
 * Development builds only: a stand-in for a scrobbler's service, such as a local server playing
 * Open Library. `scrobblerStandIn()` in core drops it in production builds.
 */
export const scrobblerStandInSetting: string | undefined =
  process.env.EXPO_PUBLIC_LELAP_SCROBBLER_STAND_IN;
