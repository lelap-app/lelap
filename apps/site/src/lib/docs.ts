/** Every docs page in the order of the docs nav; `llms.txt` and `llms-full.txt` follow it too. */
export const docsPages = [
  { href: '/docs/', label: 'Overview' },
  { href: '/docs/guide/', label: 'Your first add-on' },
  { href: '/docs/protocol/', label: 'Protocol v1' },
  { href: '/docs/data-model/', label: 'Data model samples' },
  { href: '/docs/sdk/', label: 'SDK guide' },
  { href: '/docs/samples/', label: 'Samples' },
  { href: '/docs/mapping-files/', label: 'Mapping files to works' },
  { href: '/docs/hosting/', label: 'Hosting' },
  { href: '/docs/manifest-builder/', label: 'Manifest builder' },
  { href: '/docs/checking/', label: 'Checking an add-on' },
  { href: '/docs/car-and-offline/', label: 'Car and offline' },
  { href: '/docs/scrobbling/', label: 'Scrobbling' },
] as const;

/** The page file under `src/pages/docs/` for a docs path: `/docs/` is `index`, `/docs/sdk/` is `sdk`. */
export const docsFile = (href: string) =>
  href.replace(/^\/docs\/?/, '').replace(/\/$/, '') || 'index';
