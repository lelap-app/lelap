// Android: the netfs module's fetch (M104), which refuses a declared host that resolves to an
// address on the home network, in OkHttp's own DNS step. addonFetch.web.ts uses the browser's.
import type { ManualFetch } from '@lelap/core';
import { ADDON_FETCH_ERRORS, addonFetch } from '@lelap/netfs';

export function addonManualFetch(limits: {
  timeoutMs: number;
  maxBytes: number;
  tooLarge: string;
}): ManualFetch {
  return async (url, init) => {
    try {
      const answer = await addonFetch(url, {
        method: init.method,
        ...(init.headers ? { headers: init.headers } : {}),
        ...(init.body === undefined ? {} : { body: init.body }),
        timeoutMs: limits.timeoutMs,
        maxBytes: limits.maxBytes,
        localNetwork: init.localNetwork,
      });
      return {
        status: answer.status,
        url: answer.url,
        headers: { get: (name: string) => answer.headers[name.toLowerCase()] ?? null },
        text: async () => answer.text,
      };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === ADDON_FETCH_ERRORS.private) {
        throw new Error(
          `Not allowed: ${new URL(url).hostname} points at an address on the home network.`,
          { cause: error },
        );
      }
      if (code === ADDON_FETCH_ERRORS.tooLarge) throw new Error(limits.tooLarge, { cause: error });
      throw error;
    }
  };
}
