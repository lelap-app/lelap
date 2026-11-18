import { Manifest } from '@lelap/sdk';

import { localAddonUrl } from '../local';
import { BUNDLED_FILES } from './generated';

// First-party add-ons inside the app (M57): one JavaScript file each, shipped with the app and
// updated with it (and over the air, being JavaScript). They run in the same sandbox as an
// installed one, and show as kinds in “Add a server”. Nothing lists or installs them from
// elsewhere.

export type BundledAddon = {
  /** Its `lelap-local://` manifest URL, as for an add-on installed from a file. */
  url: string;
  manifest: Manifest;
  code: string;
  sha256: string;
};

let parsed: BundledAddon[] | null = null;

export function bundledAddons(): BundledAddon[] {
  parsed ??= BUNDLED_FILES.map((entry) => {
    const manifest = Manifest.parse(entry.manifest);
    return { url: localAddonUrl(manifest.id), manifest, code: entry.code, sha256: entry.sha256 };
  });
  return parsed;
}

export const bundledAddon = (url: string): BundledAddon | null =>
  bundledAddons().find((a) => a.url === url) ?? null;
