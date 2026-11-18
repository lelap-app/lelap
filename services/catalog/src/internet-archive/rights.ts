/**
 * Which archive.org items the Internet Archive add-on may serve. This is what keeps the add-on
 * inside the neutral-core rule, so the rule is written down here and in services/README.md:
 *
 * An item is served only when at least one of these says it is free to share:
 * 1. its `licenseurl` is a Creative Commons public-domain tool (Public Domain Mark, CC0, the old
 *    Public Domain Dedication) or one of the six Creative Commons licences, any version or port;
 * 2. its `possible-copyright-status` is `NOT_IN_COPYRIGHT`;
 * 3. it is in a collection whose every item is public domain by that collection's own policy.
 *
 * Anything else is skipped: no licence, another licence, a sampling licence, a broken URL.
 * Lending-library items (`access-restricted-item`) are skipped whatever they say.
 */

// The rule trusts archive.org's own rights fields, as the uploader or archive.org set them; it
// does not judge whether a recording really is out of copyright.

export type RightsKind = 'public-domain' | 'open' | 'restricted';

/**
 * `restricted` is NC or ND. Every Creative Commons licence lets anyone share the unchanged work for free, which is all a
 * listener does. Remove `restricted` to serve only public-domain and BY or BY-SA items.
 */
export const ACCEPTED: ReadonlySet<RightsKind> = new Set<RightsKind>([
  'public-domain',
  'open',
  'restricted',
]);

/** Collections that only hold public-domain recordings, by their own rules. */
export const PUBLIC_DOMAIN_COLLECTIONS: readonly string[] = ['librivoxaudio'];

const CC_HOSTS = new Set(['creativecommons.org', 'www.creativecommons.org']);

const LICENCES: Record<string, RightsKind> = {
  by: 'open',
  'by-sa': 'open',
  'by-nc': 'restricted',
  'by-nc-sa': 'restricted',
  'by-nd': 'restricted',
  'by-nc-nd': 'restricted',
  // Version 1.0 spelled it the other way round.
  'by-nd-nc': 'restricted',
};

/** What a `licenseurl` allows, or null for anything that is not a Creative Commons licence. */
export function licenceKind(licenseurl: string | undefined): RightsKind | null {
  if (!licenseurl) return null;
  let url: URL;
  try {
    url = new URL(licenseurl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!CC_HOSTS.has(url.hostname.toLowerCase())) return null;
  const [kind, code] = url.pathname.toLowerCase().split('/').filter(Boolean);
  if (kind === 'publicdomain' && (code === 'zero' || code === 'mark')) return 'public-domain';
  if (kind !== 'licenses' || !code) return null;
  if (code === 'publicdomain') return 'public-domain';
  return Object.hasOwn(LICENCES, code) ? (LICENCES[code] ?? null) : null;
}

export function notInCopyright(status: string | undefined): boolean {
  const value = status?.trim().toLowerCase() ?? '';
  return value === 'not_in_copyright';
}

export type Rights = {
  licenseurl?: string | undefined;
  possibleCopyrightStatus?: string | undefined;
  collections?: readonly string[];
  accessRestricted?: boolean;
};

/** How the item is free to share, or null when it is not, or not clearly. */
export function rightsOf(rights: Rights): RightsKind | null {
  if (rights.accessRestricted) return null;
  const licence = licenceKind(rights.licenseurl);
  if (licence && ACCEPTED.has(licence)) return licence;
  if (notInCopyright(rights.possibleCopyrightStatus)) return 'public-domain';
  if (rights.collections?.some((c) => PUBLIC_DOMAIN_COLLECTIONS.includes(c)))
    return 'public-domain';
  return null;
}

export const isFreeToShare = (rights: Rights): boolean => rightsOf(rights) !== null;

/**
 * The same rule as a search filter, so pages are not mostly thrown away afterwards. It is looser
 * (any creativecommons.org URL); every result still goes through `rightsOf`.
 */
export const RIGHTS_QUERY =
  '(licenseurl:*creativecommons.org* OR possible-copyright-status:NOT_IN_COPYRIGHT)';
