import { type Addon, createAddon, type Manifest } from '@lelap/sdk';

import { PREFIX as OPEN_LIBRARY } from '../openlibrary';
import { TTL, type Upstream } from '../upstream';
import { findSeries } from '../wikidata';

export const BASE_PATH = '/series';

/**
 * Whole series from Wikidata (M127), as an add-on of its own: an app before revision 11 refuses a
 * manifest that lists `series`, so the Open Library catalog's manifest stays as it was.
 */
export const seriesManifest: Manifest = {
  id: 'app.lelap.series',
  version: '1.0.0',
  protocol: 1,
  protocolVersion: 11,
  name: 'Whole series',
  description: 'Every book of a series in reading order, from Wikidata.',
  types: ['audiobook'],
  resources: [{ name: 'series', types: ['audiobook'] }],
  catalogs: [],
};

export function createSeriesAddon(upstream: Upstream): Addon {
  return createAddon(
    {
      manifest: seriesManifest,
      async series({ name, extra }) {
        const work = extra.work?.startsWith(OPEN_LIBRARY)
          ? extra.work.slice(OPEN_LIBRARY.length)
          : undefined;
        const series = await findSeries(upstream, {
          name,
          author: extra.author,
          language: extra.language,
          olWork: work,
        });
        return { series, cacheMaxAge: TTL.reference };
      },
    },
    { basePath: BASE_PATH, onError: (error) => console.error(error) },
  );
}
