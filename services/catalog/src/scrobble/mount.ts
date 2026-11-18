import { type AddonHandlers, AddonError, createAddon, type Manifest } from '@lelap/sdk';

import { MAX_SEALED, type Sealer } from './sealed';

// A configurable add-on under its own path. The listener fills in `/configure`; the answer is a
// manifest URL with their settings sealed into one path segment:
//   /hardcover/configure                    the form
//   /hardcover/v1.<sealed>/manifest.json    the add-on, for this listener
//   /hardcover/manifest.json                the add-on before it is configured (it answers 401)

export type Field = {
  name: string;
  label: string;
  /** `checkbox` is a group: one box per option, all sent under the field's name. */
  type: 'text' | 'password' | 'url' | 'select' | 'checkbox';
  hint?: string;
  placeholder?: string;
  options?: { value: string; label: string; checked?: boolean }[];
  required?: boolean;
};

/** A second page once the first form is accepted, such as choosing from what the account holds. */
export type PickStep<C> = {
  intro: string;
  fields: (config: C) => Promise<Field[]>;
  /** The settings with the choices applied, or throws an `AddonError` (400) with what to fix. */
  apply: (config: C, form: (name: string) => string[]) => Promise<C>;
};

export type ConfigurableAddon<C> = {
  /** Such as `/hardcover`. */
  basePath: string;
  manifest: Manifest;
  /** Shown above the form. */
  intro: string;
  /** A link under the intro, such as the service's page for making a token. */
  introLink?: { href: string; label: string };
  /** Numbered steps under the link, such as how to make and copy the token. */
  steps?: string[];
  /** A small note under the steps. */
  stepsNote?: string;
  fields: Field[];
  /** The manifest for one listener's settings, when their catalogs depend on them. */
  manifestFor?: (config: C) => Manifest;
  pick?: PickStep<C>;
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

/** A page; `script` runs inline under a nonce, the only script the page policy lets through. */
function page(title: string, body: string, status = 200, script?: string): Response {
  const nonce = script ? crypto.randomUUID().replace(/-/g, '') : null;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escape(title)}</title>
<style>
body{margin:0;background:#14121a;color:#f4efe6;font:16px/1.5 system-ui,sans-serif}
main{max-width:34rem;margin:0 auto;padding:2rem 1rem}
label{display:block;margin:1rem 0 .25rem;font-weight:600}
input,select{box-sizing:border-box;width:100%;padding:.6rem;border-radius:.5rem;border:1px solid #3a3644;background:#1e1b26;color:inherit;font:inherit}
small,.muted{color:#a59fb0}
small{display:block;margin-top:.25rem}
.check{display:flex;gap:.5rem;align-items:center;margin:.35rem 0;font-weight:400}
a{color:#f5b041;text-underline-offset:.15em}
.check input{width:auto;margin:0}
fieldset{border:0;padding:0;margin:1rem 0 0}
legend{font-weight:600;padding:0}
.button,button[type=submit]{display:inline-flex;align-items:center;justify-content:center;margin-top:1.25rem;min-height:2.75rem;padding:.6rem 1rem;border:0;border-radius:999px;background:#f5b041;color:#14121a;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.button:focus-visible,button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid #f5b041;outline-offset:2px}
ol{padding-left:1.25rem}li{margin:.35rem 0}
code{word-break:break-all;background:#1e1b26;padding:.15rem .3rem;border-radius:.25rem}
.error{color:#ff8a80}
.copy{display:block;width:100%;text-align:left;margin:0;padding:.5rem;border:1px solid #3a3644;border-radius:.5rem;background:#1e1b26;color:inherit;font:inherit;cursor:pointer}
.copy code{background:none;padding:0;user-select:all}
.copy-note{font-size:.875rem;color:#a59fb0;margin-top:.25rem}
</style></head><body><main>${body}</main>${
    nonce ? `<script nonce="${nonce}">${script}</script>` : ''
  }</body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': nonce ? `${PAGE_CSP}; script-src 'nonce-${nonce}'` : PAGE_CSP,
      'Cache-Control': 'no-store',
    },
  });
}

function inputs(fields: Field[]): string {
  return fields
    .map((f, i) => {
      const hint = f.hint ? `<small>${escape(f.hint)}</small>` : '';
      if (f.type === 'checkbox')
        return `<fieldset><legend>${escape(f.label)}</legend>${(f.options ?? [])
          .map(
            (o, j) =>
              `<label class="check" for="${f.name}-${i}-${j}"><input type="checkbox" name="${f.name}" id="${f.name}-${i}-${j}" value="${escape(o.value)}"${
                o.checked ? ' checked' : ''
              }>${escape(o.label)}</label>`,
          )
          .join('')}${hint}</fieldset>`;
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
}

function form<C>(addon: ConfigurableAddon<C>, action: string, error?: string): Response {
  const link = addon.introLink
    ? `<p><a${addon.steps ? ' class="button"' : ''} href="${escape(addon.introLink.href)}" rel="noreferrer" target="_blank">${escape(addon.introLink.label)}</a></p>`
    : '';
  const steps = addon.steps
    ? `<ol>${addon.steps.map((step) => `<li>${escape(step)}</li>`).join('')}</ol>${
        addon.stepsNote ? `<p class="muted">${escape(addon.stepsNote)}</p>` : ''
      }`
    : '';
  return page(
    `${addon.manifest.name} for Lelap`,
    `<h1>${escape(addon.manifest.name)}</h1><p>${escape(addon.intro)}</p>${link}${steps}${
      error ? `<p class="error">${escape(error)}</p>` : ''
    }<form method="post" action="${escape(action)}">${inputs(addon.fields)}<button type="submit">${
      addon.pick ? 'Next' : 'Make my add-on link'
    }</button></form>
<p class="muted">What you enter is sealed into the link with a key only this server has. It is not stored here.</p>`,
    error ? 400 : 200,
  );
}

/** The second page; `draft` is the settings so far, sealed, so the token never shows in the page. */
async function pickPage<C>(
  addon: ConfigurableAddon<C>,
  pick: PickStep<C>,
  config: C,
  draft: string,
  action: string,
  error?: string,
): Promise<Response> {
  const fields = await pick.fields(config);
  return page(
    `${addon.manifest.name} for Lelap`,
    `<h1>${escape(addon.manifest.name)}</h1><p>${escape(pick.intro)}</p>${
      error ? `<p class="error">${escape(error)}</p>` : ''
    }<form method="post" action="${escape(action)}"><input type="hidden" name="draft" value="${escape(draft)}">${inputs(
      fields,
    )}<button type="submit">Make my add-on link</button></form>
<p class="muted">What you choose is sealed into the link with a key only this server has. It is not stored here.</p>`,
    error ? 400 : 200,
  );
}

// Tap to copy; without a clipboard the link stays selectable to copy by hand.
const COPY_LINK = `const link = document.getElementById('link');
const note = document.getElementById('note');
link.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(link.textContent.trim());
    note.textContent = 'Copied.';
  } catch {
    getSelection().selectAllChildren(link);
    note.textContent = 'Selected: copy it with your browser.';
  }
});`;

function installed(manifestUrl: string, name: string): Response {
  return page(
    `${name} is ready`,
    `<h1>Your ${escape(name)} add-on</h1>
<p><a class="button" href="${escape(`lelap://addon?manifest=${encodeURIComponent(manifestUrl)}`)}">Open in Lelap</a></p>
<p>On the phone with Lelap, that adds it in one tap. Anywhere else, such as the web app, copy this link and paste it in Lelap under Settings → Add-ons:</p><button type="button" class="copy" id="link"><code>${escape(manifestUrl)}</code></button><p class="copy-note" id="note" aria-live="polite">Tap the link to copy it.</p>
<p class="muted">Keep the link to yourself: whoever has it can report listening to your account. To stop that, revoke the token or password at the service.</p>`,
    200,
    COPY_LINK,
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
      const finish = async (config: C) => {
        const sealed = await sealer.seal(config);
        if (sealed.length > MAX_SEALED)
          throw new AddonError(400, 'That is too much for one link. Choose fewer.');
        return installed(`${url.origin}${base}/${sealed}/manifest.json`, addon.manifest.name);
      };
      const draft = body.get('draft');
      if (draft !== null && addon.pick) {
        const config = addon.revive(await sealer.open(draft));
        if (config === null) return form(addon, action, 'These settings expired. Start again.');
        try {
          return await finish(await addon.pick.apply(config, (name) => body.getAll(name)));
        } catch (error) {
          if (!(error instanceof AddonError)) addon.onError?.(error);
          const message =
            error instanceof AddonError
              ? error.message
              : 'The service could not be reached. Try again in a moment.';
          try {
            return await pickPage(addon, addon.pick, config, draft, action, message);
          } catch {
            return form(addon, action, message);
          }
        }
      }
      const values = Object.fromEntries(addon.fields.map((f) => [f.name, body.get(f.name) ?? '']));
      try {
        const config = addon.parse(values);
        await addon.check(config);
        if (addon.pick)
          return await pickPage(addon, addon.pick, config, await sealer.seal(config), action);
        return await finish(config);
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
    if (more[0] === 'configure') {
      const action = `${base}/configure`;
      // Changing the choices keeps the token: the page carries this link's sealed settings.
      if (!addon.pick) return form(addon, action);
      try {
        return await pickPage(addon, addon.pick, config, first, action);
      } catch (error) {
        if (!(error instanceof AddonError)) addon.onError?.(error);
        return form(
          addon,
          action,
          error instanceof AddonError
            ? error.message
            : 'The service could not be reached. Try again in a moment.',
        );
      }
    }
    // Built per request: the handlers close over this listener's settings.
    return createAddon(
      { manifest: addon.manifestFor?.(config) ?? addon.manifest, ...addon.handlers(config) },
      {
        basePath: `${base}/${first}`,
        ...(addon.onError ? { onError: (error: unknown) => addon.onError?.(error) } : {}),
      },
    ).fetch(request);
  };
}
