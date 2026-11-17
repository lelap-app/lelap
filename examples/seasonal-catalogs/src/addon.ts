import { CatalogResponse, createAddon, type Manifest } from '@lelap/sdk';

import data from './catalogs.json' with { type: 'json' };

// The JSON is checked against the protocol at startup, so a typo fails here and not in the app.
const catalogs = data.catalogs.map(({ id, name, metas }) => ({
  id,
  name,
  ...CatalogResponse.parse({ metas, cacheMaxAge: 86400 }),
}));

export const manifest: Manifest = {
  // Use a reverse-DNS ID of a domain you control.
  id: 'org.example.seasonal',
  version: '1.0.0',
  protocol: 1,
  name: 'Seasonal readings',
  description: 'Public-domain LibriVox recordings for Christmas and for autumn evenings.',
  types: ['audiobook'],
  // Catalogs only: the items have `librivox:` IDs, so the LibriVox add-on answers meta and streams.
  resources: ['catalog'],
  catalogs: catalogs.map(({ id, name }) => ({ type: 'audiobook', id, name })),
};

export const addon = createAddon({
  manifest,
  // createAddon only calls this for catalogs the manifest lists, so `find` always matches.
  catalog: ({ id }) => {
    const { metas, cacheMaxAge } = catalogs.find((c) => c.id === id) ?? { metas: [] };
    return { metas, cacheMaxAge };
  },
});
