// A browser can't see where a name resolves; `expo/fetch` is its own fetch here, with no cookies
// and redirects left unfollowed. The browser's own rules for local addresses apply.
import type { ManualFetch } from '@lelap/core';

import { fetch as expoFetch } from 'expo/fetch';

export function addonManualFetch(): ManualFetch {
  return (url, init) => {
    const { localNetwork, ...rest } = init;
    void localNetwork;
    return expoFetch(url, rest);
  };
}
