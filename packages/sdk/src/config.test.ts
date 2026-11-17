import { describe, expect, it } from 'vitest';

import {
  allowedReturn,
  checkFields,
  type ConfigField,
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
    const token = await encodeConfig({ token: 'hunter2' }, 'add-on secret');
    expect(token.startsWith('e1.')).toBe(true);
    expect(atob(token.slice(3).replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('hunter2');
    expect(await decodeConfig(token, 'add-on secret')).toEqual({ token: 'hunter2' });
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
    expect(await decodeConfig(`${token.slice(0, -2)}AA`, 'right')).toBeNull();
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
