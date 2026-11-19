import { checkAddon, type CheckOptions, formatReport } from '@lelap/sdk/check';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { fakeFetch, fixture, path } from './helpers';

const GUID = '5b8a6a0e-2d1c-5c3b-9a55-0f3c2a8e1b01';
const firstPage = (url: URL) =>
  (url.searchParams.get('page') ?? '1') === '1' && (url.searchParams.get('offset') ?? '0') === '0';

// The upstream answers the first-party add-ons need for one round, from the fixtures. Searches
// have one page; past it they answer nothing, as the real services do.
function setup() {
  const upstream = fakeFetch([
    [(u) => u.pathname === '/advancedsearch.php' && !firstPage(u), { response: { docs: [] } }],
    [path('/advancedsearch.php'), fixture('archive-search-secret-garden.json')],
    [
      path('/metadata/secret_garden_librivox'),
      fixture('archive-metadata-secret_garden_librivox.json'),
    ],
    [path('/metadata/Dragnet_OTR'), fixture('ia-metadata-Dragnet_OTR.json')],
    [(u) => u.pathname === '/search.json' && !firstPage(u), { numFound: 3, docs: [] }],
    [path('/search.json'), fixture('openlibrary-search-secret-garden.json')],
    [path('/works/OL69612W.json'), fixture('openlibrary-work-OL69612W.json')],
    [path('/works/OL69612W/editions.json'), fixture('openlibrary-editions-OL21745884W.json')],
    [path('/authors/OL23767A.json'), fixture('openlibrary-author-OL23767A.json')],
    [path('/api/1.0/podcasts/trending'), fixture('podcastindex-trending.json')],
    [
      (u) => u.pathname === '/api/1.0/podcasts/byfeedid' && u.searchParams.get('id') === '1001',
      fixture('podcastindex-byfeedid-1001.json'),
    ],
    [
      (u) => u.pathname === '/api/1.0/podcasts/byfeedid' && u.searchParams.get('id') === '1002',
      fixture('podcastindex-byfeedid-1002.json'),
    ],
    [path('/api/1.0/search/byterm'), fixture('podcastindex-search.json')],
    [
      (u) => u.pathname === '/api/1.0/podcasts/byguid' && u.searchParams.get('guid') === GUID,
      fixture('podcastindex-byguid.json'),
    ],
    [path('/api/1.0/podcasts/byguid'), fixture('podcastindex-byguid-unknown.json')],
    [path('/api/1.0/episodes/bypodcastguid'), fixture('podcastindex-episodes.json')],
  ]);
  const app = createApp(
    { fetch: upstream, now: () => 1_762_905_600_000 },
    {
      CONFIG_SECRET: 'a'.repeat(40),
      PODCASTINDEX_KEY: 'TESTKEY',
      PODCASTINDEX_SECRET: 'TESTSECRET',
    },
  );
  return (url: string, init?: RequestInit) => app.request(url, init);
}

const check = (mount: string, options: CheckOptions = {}) =>
  checkAddon(`https://addons.test/${mount}`, { fetch: setup(), ...options });

describe('the add-on test kit', () => {
  it('passes the Catalog', async () => {
    const report = await check('', { items: 1 });
    expect(report.problems, formatReport(report)).toEqual([]);
  });

  it('passes LibriVox', async () => {
    const report = await check('librivox/', {
      items: 0,
      ids: [{ type: 'audiobook', id: 'librivox:secret_garden_librivox' }],
    });
    expect(report.problems, formatReport(report)).toEqual([]);
  });

  it('passes the Internet Archive', async () => {
    const report = await check('internet-archive/', { items: 0 });
    expect(report.problems, formatReport(report)).toEqual([]);
  });

  it('passes Hardcover and gPodder before they are configured', async () => {
    for (const mount of ['hardcover/', 'gpodder/']) {
      const report = await check(mount);
      expect(report.problems, formatReport(report)).toEqual([]);
      expect(report.notes.join(' ')).toContain('must be configured first');
    }
  });
});
