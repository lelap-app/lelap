/**
 * Every screen of the root stack besides the tabs, as Expo Router names them. Each is declared
 * singular in the root layout; `pnpm --filter @lelap/app test` checks the list against `app/`.
 */
export const SCREENS = [
  'addon',
  'addons',
  'bookmarks',
  'car',
  'chapters',
  'convert',
  'dev/spike',
  'diagnostics',
  'downloads',
  'item',
  'list',
  'match',
  'place',
  'player',
  'podcast',
  'profile',
  'profiles',
  'scrobbler',
  'series',
  'server',
  'settings/backup',
  'settings/downloads',
  'settings/help',
  'settings/index',
  'settings/library',
  'settings/listening',
  'settings/look',
  'settings/people',
  'settings/sleep',
  'stats',
  'sync',
  'transcript',
  'up-next',
  'welcome',
  'who',
  'year',
] as const;

/**
 * A screen and its params are open at most once: a quick second tap, or a way back to a page
 * already further down, brings that one forward instead of stacking a copy.
 */
export function singularId(name: string, params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  return `${name}?${JSON.stringify(keys.map((k) => [k, params[k]]))}`;
}
