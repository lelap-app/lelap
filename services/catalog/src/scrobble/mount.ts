import { type AddonHandlers, AddonError, createAddon, type Manifest } from '@lelap/sdk';

import type { Sealer } from './sealed';

// A configurable add-on under its own path. The listener fills in `/configure`; the answer is a
// manifest URL with their settings sealed into one path segment:
//   /hardcover/configure                    the form
//   /hardcover/v1.<sealed>/manifest.json    the add-on, for this listener
//   /hardcover/manifest.json                the add-on before it is configured (it answers 401)

export type Field = {
  name: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'select';
  hint?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};

export type ConfigurableAddon<C> = {
  /** Such as `/hardcover`. */
  basePath: string;
  manifest: Manifest;
  /** Shown above the form. */
  intro: string;
  fields: Field[];
  /** Turns the form into settings, or throws an `AddonError` (400) with what to fix. */
  parse: (form: Record<string, string>) => C;
  /** Checks the settings with the service, so a typo shows now rather than as silent failures. */
  check: (config: C) => Promise<void>;
  /** The settings back from a sealed segment; null when they no longer fit. */
  revive: (value: unknown) => C | null;
  handlers: (config: C) => Omit<AddonHandlers, 'manifest'>;
  onError?: (error: unknown) => void;
};

export const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escape(title)}</title>
<style>
body{margin:0;background:#14121a;color:#f4efe6;font:16px/1.5 system-ui,sans-serif}
main{max-width:34rem;margin:0 auto;padding:2rem 1rem}
label{display:block;margin:1rem 0 .25rem;font-weight:600}
input,select{box-sizing:border-box;width:100%;padding:.6rem;border-radius:.5rem;border:1px solid #3a3644;background:#1e1b26;color:inherit;font:inherit}
small,.muted{color:#a59fb0}
button,.button{display:inline-block;margin-top:1.25rem;padding:.6rem 1rem;border:0;border-radius:999px;background:#f5b041;color:#14121a;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
code{word-break:break-all;background:#1e1b26;padding:.15rem .3rem;border-radius:.25rem}
.error{color:#ff8a80}
</style></head><body><main>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': PAGE_CSP,
      'Cache-Control': 'no-store',
    },
  });
}

function form<C>(addon: ConfigurableAddon<C>, action: string, error?: string): Response {
  const fields = addon.fields
    .map((f) => {
      const hint = f.hint ? `<small>${escape(f.hint)}</small>` : '';
      const attrs = `name="${f.name}" id="${f.name}"${f.required === false ? '' : ' required'}`;
      const input =
        f.type === 'select'
          ? `<select ${attrs}>${(f.options ?? [])
              .map((o) => `<option value="${escape(o.value)}">${escape(o.label)}</option>`)
              .join('')}</select>`
          : `<input ${attrs} type="${f.type}" autocomplete="off"${
              f.placeholder ? ` placeholder="${escape(f.placeholder)}"` : ''
            }>`;
      return `<label for="${f.name}">${escape(f.label)}</label>${input}${hint}`;
    })
    .join('');
  return page(
    `${addon.manifest.name} for Lelap`,
    `<h1>${escape(addon.manifest.name)}</h1><p>${escape(addon.intro)}</p>${
      error ? `<p class="error">${escape(error)}</p>` : ''
    }<form method="post" action="${escape(action)}">${fields}<button type="submit">Make my add-on link</button></form>
<p class="muted">What you enter is sealed into the link with a key only this server has. It is not stored here.</p>`,
    error ? 400 : 200,
  );
}

function installed(manifestUrl: string, name: string): Response {
  return page(
    `${name} is ready`,
    `<h1>Your ${escape(name)} add-on</h1>
<p>Copy this link and paste it in Lelap under Settings → Add-ons:</p><p><code>${escape(manifestUrl)}</code></p>
<p class="muted">Keep the link to yourself: whoever has it can report listening to your account. To stop that, revoke the token or password at the service.</p>`,
  );
}

const ROUTES = new Set(['manifest.json', 'configure', 'scrobble', 'catalog', 'meta', 'stream']);

/** Serves a configurable add-on; returns null for paths outside its base. */
export function mountConfigurable<C>(addon: ConfigurableAddon<C>, sealer: Sealer | null) {
  const base = addon.basePath;
  const unconfigured = createAddon(
    {
      manifest: addon.manifest,
      catalog: () => {
        throw new AddonError(401, 'Open the configure page of this add-on first');
      },
      meta: () => {
        throw new AddonError(401, 'Open the configure page of this add-on first');
      },
      scrobble: () => {
        throw new AddonError(401, 'Open the configure page of this add-on first');
      },
    },
    { basePath: base },
  );

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const rest = url.pathname.slice(base.length).replace(/^\/+/, '');
    const [first = '', ...more] = rest.split('/');

    if (first === 'configure' || (first === '' && more.length === 0)) {
      if (!sealer)
        return page(
          'Not available',
          '<h1>Not available here</h1><p>This server has no key for sealing settings (CONFIG_SECRET), so the add-on can’t be configured.</p>',
          503,
        );
      const action = `${base}/configure`;
      if (request.method !== 'POST') return form(addon, action);
      const body = new URLSearchParams(await request.text());
      const values = Object.fromEntries(addon.fields.map((f) => [f.name, body.get(f.name) ?? '']));
      try {
        const config = addon.parse(values);
        await addon.check(config);
        const sealed = await sealer.seal(config);
        return installed(`${url.origin}${base}/${sealed}/manifest.json`, addon.manifest.name);
      } catch (error) {
        if (error instanceof AddonError) return form(addon, action, error.message);
        addon.onError?.(error);
        return form(addon, action, 'The service could not be reached. Try again in a moment.');
      }
    }
    if (ROUTES.has(first)) return unconfigured.fetch(request);

    const config = sealer ? addon.revive(await sealer.open(first)) : null;
    if (config === null)
      return new Response(JSON.stringify({ error: 'Configure this add-on again' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    if (more[0] === 'configure') return form(addon, `${base}/configure`);
    // Built per request: the handlers close over this listener's settings.
    return createAddon(
      { manifest: addon.manifest, ...addon.handlers(config) },
      {
        basePath: `${base}/${first}`,
        ...(addon.onError ? { onError: (error: unknown) => addon.onError?.(error) } : {}),
      },
    ).fetch(request);
  };
}
