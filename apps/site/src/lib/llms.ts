import { experimental_AstroContainer } from 'astro/container';
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

import { site } from '../site';
import { docsFile, docsPages } from './docs';
import { findElement, parseHtml, textContent, toMarkdown } from './markdown';

// `llms.txt` (https://llmstxt.org) and `llms-full.txt` are built from the rendered docs pages, so
// coding assistants read the same text people do and the files can't drift from the pages.

export type DocText = {
  url: URL;
  label: string;
  title: string;
  description: string;
  markdown: string;
};

const modules = import.meta.glob<{ default: AstroComponentFactory }>('../pages/docs/*.astro');
const origin = new URL(`https://${site.domain}`);

/** Every docs file without its extension, such as `index` and `sdk`. */
export const docsFiles = () =>
  Object.keys(modules).map((path) => path.replace(/^.*\/(.+)\.astro$/, '$1'));

export async function renderDocs(): Promise<DocText[]> {
  const listed = new Set(docsPages.map((page) => docsFile(page.href)));
  const missing = docsFiles().filter((file) => !listed.has(file));
  if (missing.length > 0) {
    throw new Error(`Docs pages missing from docsPages in src/lib/docs.ts: ${missing.join(', ')}`);
  }
  const container = await experimental_AstroContainer.create({
    astroConfig: { site: origin.href },
  });
  return Promise.all(
    docsPages.map(async ({ href, label }) => {
      const load = modules[`../pages/docs/${docsFile(href)}.astro`];
      if (!load) throw new Error(`No page for ${href}`);
      const url = new URL(href, origin);
      const html = await container.renderToString((await load()).default, {
        request: new Request(url),
      });
      const root = parseHtml(html);
      const article = findElement(root, (el) => el.tag === 'article');
      const meta = findElement(root, (el) => el.tag === 'meta' && el.attrs.name === 'description');
      const h1 = article && findElement(article, (el) => el.tag === 'h1');
      if (!article || !h1) throw new Error(`${href} has no article with a heading`);
      return {
        url,
        label,
        title: textContent(h1).replace(/\s+/g, ' ').trim(),
        description: meta?.attrs.content ?? '',
        markdown: toMarkdown(article, url),
      };
    }),
  );
}

const summary = () =>
  `${site.name} is an open-source audiobook and podcast player for Android and the web. ` +
  `Add-ons bring everything it can browse, search and stream: small, stateless HTTP services ` +
  `that answer a few GET requests with JSON (a manifest, catalogs, metadata and streams). These ` +
  `are the developer docs for writing one, in TypeScript with @lelap/sdk or in any language ` +
  `that serves JSON.`;

export function llmsIndex(pages: DocText[]): string {
  const lines = [
    `# ${site.name} add-on developer docs`,
    '',
    `> ${summary()}`,
    '',
    `Every page below in one file: ${new URL('/llms-full.txt', origin).href}. The SDK package ` +
      `ships its own one-page guide for coding assistants at node_modules/@lelap/sdk/llms.txt.`,
    '',
    '## Docs',
    '',
    ...pages.map((page) => `- [${page.label}](${page.url.href}): ${page.description}`),
    '',
    '## Optional',
    '',
    `- [JSON Schema](${new URL('/docs/protocol.schema.json', origin).href}): every response ` +
      `of protocol v1, for validating in other languages.`,
    `- [Source code](${site.repoUrl}): the app, the SDK, the first-party add-ons and the ` +
      `samples.`,
    '',
  ];
  return lines.join('\n');
}

export function llmsFull(pages: DocText[]): string {
  const head = `# ${site.name} add-on developer docs\n\n> ${summary()}`;
  const body = pages.map((page) => `<!-- ${page.url.href} -->\n\n${page.markdown}`);
  return `${[head, ...body].join('\n\n---\n\n')}\n`;
}

export const textResponse = (text: string) =>
  new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
