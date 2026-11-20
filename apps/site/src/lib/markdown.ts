// A small HTML-to-Markdown converter for the docs pages' own markup, so `llms-full.txt` is built
// from the rendered pages without a parsing dependency. It knows the elements the docs use.

type Element = { tag: string; attrs: Record<string, string>; children: Node[] };
type Node = Element | string;

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'wbr',
]);
const RAW = new Set(['script', 'style', 'template', 'textarea']);
// Interactive or decorative parts that mean nothing as text.
const SKIP = new Set([
  'button',
  'form',
  'nav',
  'noscript',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
]);
const BLOCK = new Set([
  'article',
  'blockquote',
  'details',
  'div',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'label',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'ul',
]);

const decode = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[lower] ?? '';
  });

const TAG =
  /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/gi;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export function parseHtml(html: string): Element {
  const root: Element = { tag: '#root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  let last = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(html); match; match = TAG.exec(html)) {
    const top = stack.at(-1) ?? root;
    if (match.index > last) top.children.push(decode(html.slice(last, match.index)));
    last = TAG.lastIndex;
    const [, closing, name, rawAttrs = ''] = match;
    if (!name) continue;
    const tag = name.toLowerCase();
    if (closing) {
      const at = stack.map((element) => element.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const [, key, double, single, bare] of rawAttrs.matchAll(ATTR)) {
      if (key) attrs[key.toLowerCase()] = decode(double ?? single ?? bare ?? '');
    }
    const element: Element = { tag, attrs, children: [] };
    top.children.push(element);
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, last);
      const stop = end === -1 ? html.length : end;
      element.children.push(decode(html.slice(last, stop)));
      TAG.lastIndex = last = stop;
    } else if (!VOID.has(tag)) {
      stack.push(element);
    }
  }
  if (last < html.length) (stack.at(-1) ?? root).children.push(decode(html.slice(last)));
  return root;
}

export function findElement(node: Node, test: (element: Element) => boolean): Element | undefined {
  if (typeof node === 'string') return undefined;
  if (test(node)) return node;
  for (const child of node.children) {
    const found = findElement(child, test);
    if (found) return found;
  }
  return undefined;
}

export const textContent = (node: Node): string =>
  typeof node === 'string' ? node : node.children.map(textContent).join('');

const hasClass = (element: Element, name: string) =>
  (element.attrs.class ?? '').split(/\s+/).includes(name);

const codeSpan = (text: string) => {
  const ticks = '`'.repeat(Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
};

type Options = { url: URL };

function inline(nodes: Node[], options: Options): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') {
      out += node.replace(/\s+/g, ' ');
      continue;
    }
    if (SKIP.has(node.tag)) continue;
    const inner = () => inline(node.children, options);
    switch (node.tag) {
      case 'code':
        out += codeSpan(textContent(node).replace(/\s+/g, ' '));
        break;
      case 'strong':
      case 'b': {
        const text = inner().trim();
        if (text) out += `**${text}**`;
        break;
      }
      case 'em':
      case 'i': {
        const text = inner().trim();
        if (text) out += `*${text}*`;
        break;
      }
      case 'a': {
        const text = inner().trim();
        const href = node.attrs.href;
        out += href ? `[${text}](${new URL(href, options.url).href})` : text;
        break;
      }
      case 'br':
        out += '  \n';
        break;
      case 'input':
        break;
      default:
        out += inner();
    }
  }
  return out;
}

const tidy = (text: string) =>
  text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();

function table(element: Element, options: Options): string {
  const rows: string[][] = [];
  const collect = (node: Node) => {
    if (typeof node === 'string') return;
    if (node.tag === 'tr') {
      rows.push(
        node.children
          .filter((cell): cell is Element => typeof cell !== 'string' && /^t[hd]$/.test(cell.tag))
          .map((cell) => tidy(inline(cell.children, options)).replace(/\|/g, '\\|')),
      );
      return;
    }
    node.children.forEach(collect);
  };
  collect(element);
  const [head, ...body] = rows;
  if (!head) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => row[i] ?? '').join(' | ')} |`;
  return [line(head), line(Array(width).fill('---')), ...body.map(line)].join('\n');
}

const indent = (text: string, by: string) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 || line === '' ? line : by + line))
    .join('\n');

function list(element: Element, options: Options): string {
  const ordered = element.tag === 'ol';
  let n = Number(element.attrs.start ?? 1);
  return element.children
    .filter((child): child is Element => typeof child !== 'string' && child.tag === 'li')
    .map((item) => {
      const marker = ordered ? `${n++}.` : '-';
      const body = blocks(item.children, options).join('\n\n');
      return `${marker} ${indent(body, ' '.repeat(marker.length + 1))}`;
    })
    .join('\n');
}

function block(element: Element, options: Options): string[] {
  const { tag } = element;
  if (SKIP.has(tag)) return [];
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    const text = tidy(inline(element.children, options));
    return text ? [`${'#'.repeat(Number(heading[1]))} ${text}`] : [];
  }
  switch (tag) {
    case 'pre': {
      const code = textContent(element).replace(/^\n+|\s+$/g, '');
      const fence = '`'.repeat(
        Math.max(3, ...[...code.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)),
      );
      return [`${fence}\n${code}\n${fence}`];
    }
    case 'ul':
    case 'ol': {
      const text = list(element, options);
      return text ? [text] : [];
    }
    case 'table': {
      const text = table(element, options);
      return text ? [text] : [];
    }
    case 'figcaption':
    case 'summary': {
      const text = tidy(inline(element.children, options));
      return text ? [`**${text}**`] : [];
    }
    case 'blockquote':
      return [quote(blocks(element.children, options))];
    case 'div':
      if (hasClass(element, 'note')) return [quote(blocks(element.children, options))];
      return blocks(element.children, options);
    default:
      return blocks(element.children, options);
  }
}

const quote = (parts: string[]) =>
  parts
    .join('\n\n')
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');

function blocks(nodes: Node[], options: Options): string[] {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    const text = tidy(inline(run, options));
    if (text) out.push(text);
    run = [];
  };
  for (const node of nodes) {
    if (typeof node !== 'string' && (BLOCK.has(node.tag) || node.tag === 'li')) {
      flush();
      out.push(...block(node, options));
    } else {
      run.push(node);
    }
  }
  flush();
  return out;
}

/** Markdown for an element's content; relative links resolve against `url`. */
export const toMarkdown = (element: Element, url: URL) =>
  blocks(element.children, { url }).join('\n\n');
