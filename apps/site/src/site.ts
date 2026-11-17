// Hosts come from the environment so forks and self-hosters can build the site for their own domain.
const domain = import.meta.env.PUBLIC_LELAP_DOMAIN ?? 'lelap.app';
const repoUrl = import.meta.env.PUBLIC_LELAP_REPO_URL ?? 'https://github.com/lelap-app/lelap';

export const site = {
  name: 'Lelap',
  tagline: 'From first chapter to fast asleep.',
  descriptor: 'The open player for audiobooks and podcasts.',
  domain,
  appHost: `listen.${domain}`,
  appUrl: `https://listen.${domain}`,
  downloadsHost: `dl.${domain}`,
  // The release workflow copies each stable APK to latest.apk next to latest.json.
  apkUrl: `https://dl.${domain}/latest.apk`,
  releaseInfoUrl: `https://dl.${domain}/latest.json`,
  repoUrl,
  releasesUrl: `${repoUrl}/releases`,
  briefUrl: `${repoUrl}/blob/main/docs/brief.md`,
  contributingUrl: `${repoUrl}/blob/main/CONTRIBUTING.md`,
  copyrightEmail: `copyright@${domain}`,
  privacyEmail: `privacy@${domain}`,
  // Until the first stable release, download and "open app" buttons are replaced by links to the repository.
  released: import.meta.env.PUBLIC_LELAP_RELEASED === 'true',
  // Before that, a beta APK can be offered on its own; the release workflow keeps beta.apk current.
  beta:
    import.meta.env.PUBLIC_LELAP_BETA === 'true' &&
    import.meta.env.PUBLIC_LELAP_RELEASED !== 'true',
  betaApkUrl: `https://dl.${domain}/beta.apk`,
  betaInfoUrl: `https://dl.${domain}/beta.json`,
} as const;
