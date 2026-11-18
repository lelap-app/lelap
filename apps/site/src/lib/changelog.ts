// Reads CHANGELOG.md for the changelog page at build time. The file uses a small part of Markdown:
// `##` per release, `###` per group, paragraphs, `- ` lists, `code` and pull request numbers like
// (#169). Anything else stays plain text, so the page never needs a Markdown library or a script.

export type Inline = { kind: 'text' | 'code'; value: string } | { kind: 'pr'; number: number };
export type Block = { kind: 'p'; text: Inline[] } | { kind: 'ul'; items: Inline[][] };

export interface Group {
  title: string;
  blocks: Block[];
}

export interface Release {
  /** For the anchor: `0.1.0-beta.8` becomes `v0-1-0-beta-8`. */
  id: string;
  version: string;
  /** As written, such as `2026-11-18`; null when the heading has none. */
  date: string | null;
  intro: Block[];
  groups: Group[];
}

/** Splits a line into text, `code` and pull request numbers. */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (part: Inline) => {
    const last = out.at(-1);
    if (part.kind === 'text' && last?.kind === 'text') last.value += part.value;
    else if (part.kind !== 'text' || part.value) out.push(part);
  };
  const pieces = text.split('`');
  for (const [i, piece] of pieces.entries()) {
    // An odd piece sits between backticks; after a lone backtick at the end, it stays text.
    if (i % 2 === 1 && i < pieces.length - 1) {
      push({ kind: 'code', value: piece });
      continue;
    }
    if (i % 2 === 1) push({ kind: 'text', value: '`' });
    let at = 0;
    for (const m of piece.matchAll(/#(\d+)\b/g)) {
      push({ kind: 'text', value: piece.slice(at, m.index) });
      push({ kind: 'pr', number: Number(m[1]) });
      at = m.index + m[0].length;
    }
    push({ kind: 'text', value: piece.slice(at) });
  }
  return out;
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  let item: string[] | null = null;
  let list: string[][] | null = null;
  const flush = () => {
    if (paragraph.length) out.push({ kind: 'p', text: inline(paragraph.join(' ')) });
    paragraph = [];
    if (item && list) list.push(item);
    item = null;
    if (list) out.push({ kind: 'ul', items: list.map((lines) => inline(lines.join(' '))) });
    list = null;
  };
  for (const line of lines) {
    if (!line.trim()) {
      // A blank line ends a paragraph; a list goes on if the next line is another item.
      if (paragraph.length) flush();
      continue;
    }
    if (line.startsWith('- ')) {
      if (paragraph.length) flush();
      if (item && list) list.push(item);
      list ??= [];
      item = [line.slice(2).trim()];
    } else if (item && /^\s/.test(line)) {
      item.push(line.trim());
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return out;
}

/** The releases in CHANGELOG.md, newest first as the file has them. */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let group: Group | null = null;
  let lines: string[] = [];
  const close = () => {
    const parsed = blocks(lines);
    if (group) group.blocks = parsed;
    else if (release) release.intro = parsed;
    lines = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (!heading) {
      lines.push(line);
      continue;
    }
    close();
    const level = heading[1];
    const title = (heading[2] ?? '').trim();
    if (level === '##') {
      const m = /^(\S+)(?:\s+\(([^)]+)\))?/.exec(title);
      const version = m?.[1] ?? title;
      release = {
        id: `v${version.replace(/[^\w]+/g, '-')}`,
        version,
        date: m?.[2] ?? null,
        intro: [],
        groups: [],
      };
      releases.push(release);
      group = null;
    } else if (level === '###' && release) {
      group = { title, blocks: [] };
      release.groups.push(group);
    } else {
      // The file's own title and introduction belong to the page, not to a release.
      group = null;
      release = null;
    }
  }
  close();
  return releases;
}
