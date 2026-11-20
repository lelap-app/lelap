import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { docsFile, docsPages } from '../src/lib/docs';
import { llmsFull, llmsIndex, renderDocs } from '../src/lib/llms';
import { site } from '../src/site';

const files = readdirSync(new URL('../src/pages/docs/', import.meta.url))
  .filter((name) => name.endsWith('.astro'))
  .map((name) => name.replace(/\.astro$/, ''));

describe('llms.txt and llms-full.txt', async () => {
  const pages = await renderDocs();
  const index = llmsIndex(pages);
  const full = llmsFull(pages);

  it('know every docs page', () => {
    expect(docsPages.map((page) => docsFile(page.href)).sort()).toEqual([...files].sort());
  });

  it.each(pages.map((page) => [page.url.pathname, page] as const))('carry %s', (_, page) => {
    expect(index).toContain(`[${page.label}](${page.url.href}): ${page.description}`);
    expect(page.description).not.toBe('');
    expect(full).toContain(`<!-- ${page.url.href} -->\n\n# ${page.title}\n`);
    expect(full).toContain(page.markdown);
  });

  it('use the configured host and leave no markup behind', () => {
    expect(index).toContain(`https://${site.domain}/llms-full.txt`);
    const prose = full.replace(/^(`{3,})[\s\S]*?^\1$/gm, '').replace(/`[^`\n]*`/g, '');
    expect(prose).not.toMatch(
      /<\/?(?:a|code|div|em|figure|h\d|li|ol|p|pre|span|strong|table|td|th|tr|ul)\b|&(?:amp|lt|gt|quot|#\d+);/i,
    );
  });
});
