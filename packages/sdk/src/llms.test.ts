import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as check from './check';
import * as sdk from './index';

// llms.txt is what coding assistants read; every function it names must exist.
describe('llms.txt', () => {
  const text = readFileSync(new URL('../llms.txt', import.meta.url), 'utf8');
  const exported = new Set([...Object.keys(sdk), ...Object.keys(check)]);

  it('names only exports that exist', () => {
    const named = [...text.matchAll(/`([a-zA-Z]+)(?:\(|`)/g)]
      .map((m) => m[1] ?? '')
      .filter((name) => /^[a-z][a-zA-Z]+$/.test(name) && /[A-Z]/.test(name));
    const helpers = named.filter(
      (name) =>
        ![
          'protocolVersion',
          'idPrefixes',
          'cacheMaxAge',
          'sourceKey',
          'durationMs',
          'basePath',
          'executionCtx',
          'onError',
          'waitUntil',
          'retryAfter',
          'placeholder',
        ].includes(name),
    );
    expect(helpers.length).toBeGreaterThan(10);
    expect(helpers.filter((name) => !exported.has(name))).toEqual([]);
  });

  it('states the revision the SDK speaks', () => {
    expect(text).toContain(`revision ${sdk.LATEST_PROTOCOL_VERSION} `);
  });
});
