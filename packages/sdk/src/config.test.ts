import { describe, expect, it } from 'vitest';

import {
  allowedReturn,
  checkFields,
  type ConfigField,
  configurePage,
  decodeConfig,
  encodeConfig,
  isConfigToken,
  readForm,
  returnUrl,
} from './config';

const fields: ConfigField[] = [
  { key: 'server', label: 'Server', type: 'text', required: true },
  { key: 'token', label: 'Token', type: 'password' },
  { key: 'language', label: 'Language', type: 'select', options: ['en', 'de'] },
  { key: 'explicit', label: 'Explicit', type: 'checkbox' },
];

// Long, so the encrypted bytes cannot contain it by chance.
const PLAIN = 'a plain token 3b07';

const form = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

describe('config tokens', () => {
  it('round-trips a plain token, which is URL-safe', async () => {
    const token = await encodeConfig({ server: 'https://a.example/?x=1&y=ü', explicit: true });
    expect(isConfigToken(token)).toBe(true);
    expect(token).toMatch(/^p1\.[A-Za-z0-9_-]+$/);
    expect(await decodeConfig(token)).toEqual({
      server: 'https://a.example/?x=1&y=ü',
      explicit: true,
    });
  });

  it('encrypts with a secret and hides the values', async () => {
    const token = await encodeConfig({ token: PLAIN }, 'add-on secret');
    expect(token.startsWith('e1.')).toBe(true);
    expect(atob(token.slice(3).replace(/-/g, '+').replace(/_/g, '/'))).not.toContain(PLAIN);
    expect(await decodeConfig(token, 'add-on secret')).toEqual({ token: PLAIN });
  });

  it('binds a token to the add-on that sealed it, and still reads e1 tokens', async () => {
    const token = await encodeConfig({ a: 'b' }, 'shared', 'org.example.one');
    expect(token.startsWith('e2.')).toBe(true);
    expect(isConfigToken(token)).toBe(true);
    expect(await decodeConfig(token, 'shared', 'org.example.one')).toEqual({ a: 'b' });
    // Another add-on with the same secret can't open it, nor can a reader that names no add-on.
    expect(await decodeConfig(token, 'shared', 'org.example.two')).toBeNull();
    expect(await decodeConfig(token, 'shared')).toBeNull();
    // A token sealed before IDs keeps working.
    const old = await encodeConfig({ a: 'b' }, 'shared');
    expect(await decodeConfig(old, 'shared', 'org.example.one')).toEqual({ a: 'b' });
  });

  it('uses a fresh IV each time', async () => {
    const a = await encodeConfig({ a: 'b' }, 's');
    const b = await encodeConfig({ a: 'b' }, 's');
    expect(a).not.toBe(b);
  });

  it('refuses a wrong secret, damage, and plain tokens when a secret is set', async () => {
    const token = await encodeConfig({ a: 'b' }, 'right');
    expect(await decodeConfig(token, 'wrong')).toBeNull();
    expect(await decodeConfig(token)).toBeNull();
    // Change the last two characters to something they weren't, so the damage is always real.
    const damaged = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(await decodeConfig(damaged, 'right')).toBeNull();
    expect(await decodeConfig(await encodeConfig({ a: 'b' }), 'right')).toBeNull();
    expect(await decodeConfig('p1.!!!')).toBeNull();
    expect(await decodeConfig('catalog')).toBeNull();
  });

  it('refuses tokens that are not a flat object', async () => {
    const encode = (value: unknown) =>
      `p1.${btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    expect(await decodeConfig(encode([1]))).toBeNull();
    expect(await decodeConfig(encode({ a: { b: 1 } }))).toBeNull();
    expect(await decodeConfig(encode({ a: 1 }))).toBeNull();
  });
});

describe('fields', () => {
  it('needs a secret for passwords and options for selects', () => {
    expect(() => checkFields(fields, undefined)).toThrow(/secret/);
    expect(() => checkFields(fields, 's')).not.toThrow();
    expect(() => checkFields([{ key: 'a', label: 'A', type: 'select' }], 's')).toThrow(/options/);
    expect(() => checkFields([{ key: 'a b', label: 'A', type: 'text' }], 's')).toThrow();
  });

  it('reads a form', () => {
    expect(readForm(fields, form({ server: ' https://a.example ', explicit: 'on' }))).toEqual({
      config: { server: 'https://a.example', explicit: true },
    });
    expect(readForm(fields, form({}))).toEqual({ error: 'Server is required.' });
    expect(readForm(fields, form({ server: 'x', language: 'fr' }))).toEqual({
      error: 'Pick one of the choices for Language.',
    });
  });
});

describe('return addresses', () => {
  it('always allows the app and only listed web origins', () => {
    expect(allowedReturn('lelap://addon')).toBe(true);
    expect(allowedReturn('lelap://addon/')).toBe(true);
    expect(allowedReturn('lelap://other')).toBe(false);
    expect(allowedReturn('https://listen.example.org/addon')).toBe(false);
    expect(allowedReturn('https://listen.example.org/addon', ['https://listen.example.org/'])).toBe(
      true,
    );
    expect(allowedReturn('https://evil.example/addon', ['https://listen.example.org'])).toBe(false);
    expect(allowedReturn('http://listen.example.org/addon', ['http://listen.example.org'])).toBe(
      false,
    );
    expect(allowedReturn('javascript:alert(1)')).toBe(false);
  });

  it('puts the manifest URL in a query parameter', () => {
    expect(returnUrl('lelap://addon', 'https://a.example/p1.x/manifest.json')).toBe(
      'lelap://addon?manifest=https%3A%2F%2Fa.example%2Fp1.x%2Fmanifest.json',
    );
  });
});

describe('sign-in on the configure page', () => {
  const signIn = {
    href: '/svc/oauth/start',
    label: 'Sign in with Svc',
    note: 'Revoke it any time at Svc.',
    other: 'Or paste a token',
  };

  it('offers the sign-in button first, with the return address, and folds the form', () => {
    const html = configurePage({
      name: 'Svc',
      description: 'd',
      fields,
      returnTo: 'lelap://addon',
      text: { intro: 'Hi', signIn },
    });
    expect(html).toContain(
      `<a class="button" href="/svc/oauth/start?return=${encodeURIComponent('lelap://addon')}">Sign in with Svc</a>`,
    );
    expect(html).toContain('<details><summary>Or paste a token</summary>');
    expect(html.indexOf('Sign in with Svc')).toBeLessThan(html.indexOf('<form'));
  });

  it('opens the fold when the form has an error', () => {
    const html = configurePage({
      name: 'Svc',
      description: 'd',
      fields,
      error: 'Wrong token',
      text: { signIn },
    });
    expect(html).toContain('<details open>');
    expect(html).toContain('href="/svc/oauth/start"');
  });

  it('leaves out a sign-in that leads off the add-on’s host', () => {
    for (const href of ['https://evil.example/', '//evil.example/x', 'javascript:alert(1)']) {
      const html = configurePage({
        name: 'Svc',
        description: 'd',
        fields,
        text: { signIn: { ...signIn, href } },
      });
      expect(html).not.toContain('Sign in with Svc');
      expect(html).not.toContain('<details');
    }
  });
});
