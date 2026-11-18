import { type AddonHandlers, AddonError, createAddon, type Manifest, PAGE_STYLE } from '@lelap/sdk';

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
  /** What a text field holds, such as what the listener typed before an error. */
  value?: string;
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
<style>${PAGE_STYLE}</style></head><body><main>${body}</main>${
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
      const hint = f.hint ? `<p class="help">${escape(f.hint)}</p>` : '';
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
            }${f.value && f.type !== 'password' ? ` value="${escape(f.value)}"` : ''}>`;
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

/** The fields as the listener sent them: their ticks and what they typed, not the defaults. */
export function asSent(fields: Field[], sent: (name: string) => string[]): Field[] {
  return fields.map((f) => {
    const values = sent(f.name);
    if (f.type === 'checkbox')
      return {
        ...f,
        options: (f.options ?? []).map((o) => ({ ...o, checked: values.includes(o.value) })),
      };
    if (f.type === 'password') return f;
    return { ...f, value: values[0] ?? '' };
  });
}

/**
 * The second page; `draft` is the settings so far, sealed as a draft, so the token never shows in
 * the page. After an error, `sent` keeps what the listener chose.
 */
async function pickPage<C>(
  addon: ConfigurableAddon<C>,
  pick: PickStep<C>,
  config: C,
  draft: string,
  action: string,
  error?: string,
  sent?: (name: string) => string[],
): Promise<Response> {
  const listed = await pick.fields(config);
  const fields = sent ? asSent(listed, sent) : listed;
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

/** How long the choices page keeps its draft: long enough to read a few lists and choose. */
export const DRAFT_MS = 60 * 60 * 1000;

/**
 * Serves a configurable add-on; returns null for paths outside its base. `sealer` seals finished
 * links; `drafts` seals the settings between the first and second page, apart from links and
 * with a time, so a draft from a page's source is never an add-on link and runs out.
 */
export function mountConfigurable<C>(
  addon: ConfigurableAddon<C>,
  sealer: Sealer | null,
  drafts: Sealer | null = null,
  now: () => number = Date.now,
) {
  const base = addon.basePath;
  const sealDraft = async (config: C) => {
    if (!drafts) throw new Error('No sealer for drafts');
    return drafts.seal({ config, until: now() + DRAFT_MS });
  };
  const openDraft = async (draft: string): Promise<C | null> => {
    const value = (await drafts?.open(draft)) as { config?: unknown; until?: unknown } | null;
    if (!value || typeof value.until !== 'number' || value.until < now()) return null;
    return addon.revive(value.config);
  };
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
      if (!sealer || (addon.pick && !drafts))
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
        const config = await openDraft(draft);
        if (config === null) return form(addon, action, 'These settings expired. Start again.');
        const sent = (name: string) => body.getAll(name);
        try {
          return await finish(await addon.pick.apply(config, sent));
        } catch (error) {
          if (!(error instanceof AddonError)) addon.onError?.(error);
          const message =
            error instanceof AddonError
              ? error.message
              : 'The service could not be reached. Try again in a moment.';
          try {
            return await pickPage(addon, addon.pick, config, draft, action, message, sent);
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
          return await pickPage(addon, addon.pick, config, await sealDraft(config), action);
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
      // Changing the choices keeps the token: the page carries a draft of this link's settings.
      if (!addon.pick || !drafts) return form(addon, action);
      try {
        return await pickPage(addon, addon.pick, config, await sealDraft(config), action);
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
