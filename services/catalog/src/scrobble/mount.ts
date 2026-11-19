import {
  type AddonHandlers,
  AddonError,
  type Config,
  type ConfigField,
  type ConfigureText,
  createAddon,
  type Manifest,
  PAGE_STYLE,
} from '@lelap/sdk';

import type { Sealer } from './sealed';

// Our scrobblers on the SDK's configure (M102). Each keeps its settings typed; the SDK seals them
// into the add-on's address and serves the pages:
//   /hardcover/configure                    the form (and a second page of choices)
//   /hardcover/e2.<sealed>/manifest.json    the add-on, for this listener
//   /hardcover/v1.<sealed>/manifest.json    a link made before M102, still opened
//   /hardcover/manifest.json                the add-on before it is configured

export type ScrobbleAddon<C> = {
  /** Such as `/hardcover`. */
  basePath: string;
  manifest: Manifest;
  text: ConfigureText;
  fields: ConfigField[];
  /** The typed settings from what the SDK keeps (or a link from before M102); null when odd. */
  revive: (value: unknown) => C | null;
  /** What the SDK keeps for typed settings: strings, booleans and lists of strings. */
  store: (config: C) => Config;
  /** The typed settings from the form; throws an `AddonError` (400) with what to fix. */
  parse?: (config: Config) => C;
  /** Checks the settings with the service; throws an `AddonError` (400) with what to fix. */
  check: (config: C) => Promise<void>;
  choose?: {
    intro: string;
    fields: (config: C) => Promise<ConfigField[]>;
    /** The settings with the choices; throws an `AddonError` (400) with what to fix. */
    apply: (config: C, chosen: Config) => Promise<C>;
  };
  /** The manifest for one listener's settings, when their catalogs depend on them. */
  manifestFor?: (config: C) => Manifest;
  handlers: (config: C) => Omit<AddonHandlers, 'manifest' | 'configure'>;
};

export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";

function unavailable(): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not available</title><style>${PAGE_STYLE}</style></head><body><main><h1>Not available here</h1><p>This server has no key for sealing settings (CONFIG_SECRET), so the add-on can’t be configured.</p></main></body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': PAGE_CSP,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Serves a scrobbler on the SDK's configure; returns null for paths outside its base. `secret` is
 * `CONFIG_SECRET`; without one of 32 characters the add-on can't be configured. `legacy` opens
 * links made before M102.
 */
export function serveScrobbleAddon<C>(
  addon: ScrobbleAddon<C>,
  options: {
    secret: string | undefined;
    legacy: Sealer | null;
    returnOrigins?: string[];
    onError?: (error: unknown) => void;
    now?: () => number;
  },
): (request: Request) => Promise<Response> {
  const secret = options.secret?.trim();
  const { revive, store } = addon;
  const typed = (config: Config | null): C => {
    const value = config ? revive(config) : null;
    // The SDK only calls handlers with a config that opened; one that no longer fits is refused.
    if (value === null) throw new AddonError(401, 'Configure this add-on again');
    return value;
  };
  // A message for the listener from an `AddonError`; anything else goes to the SDK, which logs it.
  const said = async (run: () => Promise<void>): Promise<string | undefined> => {
    try {
      await run();
      return undefined;
    } catch (error) {
      if (error instanceof AddonError) return error.message;
      throw error;
    }
  };
  const { handlers, choose, manifestFor } = addon;
  const legacy = options.legacy;
  const served = createAddon(
    {
      manifest: addon.manifest,
      ...(secret && secret.length >= 32
        ? {
            configure: {
              secret,
              fields: addon.fields,
              text: addon.text,
              ...(options.returnOrigins ? { returnOrigins: options.returnOrigins } : {}),
              check: (config) =>
                said(() => addon.check(addon.parse ? addon.parse(config) : typed(config))),
              ...(choose
                ? {
                    choose: {
                      intro: choose.intro,
                      fields: (config: Config) => choose.fields(typed(config)),
                      apply: async (config: Config, chosen: Config) => {
                        try {
                          return store(await choose.apply(typed(config), chosen));
                        } catch (error) {
                          if (error instanceof AddonError) return error.message;
                          throw error;
                        }
                      },
                    },
                  }
                : {}),
              ...(manifestFor ? { manifest: (config: Config) => manifestFor(typed(config)) } : {}),
              ...(legacy
                ? {
                    legacy: {
                      prefix: 'v1.',
                      open: async (segment: string) => {
                        const value = revive(await legacy.open(segment));
                        return value === null ? null : store(value);
                      },
                    },
                  }
                : {}),
            },
          }
        : {}),
      catalog: (args) => {
        const run = handlers(typed(args.config)).catalog;
        if (!run) throw new AddonError(404, 'Not found');
        return run(args);
      },
      meta: (args) => {
        const run = handlers(typed(args.config)).meta;
        if (!run) throw new AddonError(404, 'Not found');
        return run(args);
      },
      scrobble: (args) => {
        const run = handlers(typed(args.config)).scrobble;
        if (!run) throw new AddonError(404, 'Not found');
        return run(args);
      },
    },
    {
      basePath: addon.basePath,
      ...(options.now ? { now: options.now } : {}),
      ...(options.onError ? { onError: (error: unknown) => options.onError?.(error) } : {}),
    },
  );
  const configurable = secret !== undefined && secret.length >= 32;
  return async (request) => {
    const rest = new URL(request.url).pathname.slice(addon.basePath.length).replace(/^\/+/, '');
    if (!configurable && (rest === '' || rest === 'configure')) return unavailable();
    // The bare base is the configure page, as before M102.
    if (rest === '')
      return served.fetch(
        new Request(new URL(`${addon.basePath}/configure`, request.url), request),
      );
    return served.fetch(request);
  };
}
