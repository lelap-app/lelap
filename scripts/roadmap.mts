// Writes the milestone table in docs/roadmap.md from each milestone file's front matter, run with
// Node's type stripping:
//   node scripts/roadmap.mts           rewrites the table
//   node scripts/roadmap.mts --check   exits with 1 when the table is out of date
//   node scripts/roadmap.mts checks    prints every unticked item under “## Open checks”;
//                                      --adb or --you keeps the checks with that tag
//   node scripts/roadmap.mts status    prints every milestone as JSON for the roadmap-status skill
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as prettier from 'prettier';

const DOCS = 'docs';
const ROADMAP = join(DOCS, 'roadmap.md');
const MILESTONES = join(DOCS, 'milestones');
const START = '<!-- milestones:start -->';
const END = '<!-- milestones:end -->';
const STATUSES = { planned: 'Planned', 'in progress': 'In progress', done: 'Done' } as const;

type Status = keyof typeof STATUSES;
type Milestone = {
  n: number;
  file: string;
  title: string;
  status: Status;
  summary: string;
  prs: number[];
  checks: string[];
  text: string;
};

/** Reads a scalar: plain, "double-quoted" or 'single-quoted', as Prettier writes them. */
function scalar(raw: string, where: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    if (!v.endsWith('"') || v.length < 2) throw new Error(`${where}: unclosed "`);
    return JSON.parse(v) as string;
  }
  if (v.startsWith("'")) {
    if (!v.endsWith("'") || v.length < 2) throw new Error(`${where}: unclosed '`);
    return v.slice(1, -1).replaceAll("''", "'");
  }
  return v;
}

/** Parses the small YAML subset milestone files use: `key: scalar` and `key: [1, 2]`. */
function frontMatter(text: string, where: string): Record<string, string | number[]> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match?.[1]) throw new Error(`${where}: no front matter`);
  const fields: Record<string, string | number[]> = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error(`${where}: can't read “${line}”`);
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (value.startsWith('[')) {
      if (!value.endsWith(']')) throw new Error(`${where}: ${key} must be a list on one line`);
      const items = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      fields[key] = items.map((s) => {
        const pr = Number(s);
        if (!Number.isInteger(pr) || pr < 1) throw new Error(`${where}: ${key} has “${s}”`);
        return pr;
      });
    } else {
      fields[key] = scalar(value, `${where}: ${key}`);
    }
  }
  return fields;
}

function readMilestones(): Milestone[] {
  const files = readdirSync(MILESTONES).filter((f) => /^m\d+\.md$/.test(f));
  return files
    .map((file) => {
      const where = join(MILESTONES, file);
      const text = readFileSync(where, 'utf8');
      const fields = frontMatter(text, where);
      const n = Number(file.slice(1, -3));
      const { title, status, summary, prs } = fields;
      if (typeof title !== 'string' || !title) throw new Error(`${where}: title is missing`);
      if (typeof summary !== 'string' || !summary) throw new Error(`${where}: summary is missing`);
      if (typeof status !== 'string' || !(status in STATUSES)) {
        throw new Error(`${where}: status must be one of ${Object.keys(STATUSES).join(', ')}`);
      }
      if (!Array.isArray(prs)) throw new Error(`${where}: prs must be a list, [] when none`);
      const checks = openChecks(text);
      const untagged = checks.find(
        (c) => c.startsWith('- [ ]') && !/^- \[ \] \((adb|you)\) /.test(c),
      );
      if (untagged)
        throw new Error(`${where}: start each open check with (adb) or (you): ${untagged}`);
      // The heading and the table must name the milestone the same way.
      if (!text.includes(`\n# M${n} ${title}\n`)) {
        throw new Error(`${where}: the heading must be “# M${n} ${title}”`);
      }
      return { n, file, title, status: status as Status, summary, prs, checks, text };
    })
    .sort((a, b) => a.n - b.n);
}

const countChecks = (checks: string[]) => checks.filter((c) => c.startsWith('- [ ]')).length;

function table(milestones: Milestone[]): string {
  const rows = milestones.map((m) => {
    const open = countChecks(m.checks) || '';
    const summary = m.summary.replaceAll('|', '\\|');
    return `| [M${m.n} ${m.title}](milestones/${m.file}) | ${STATUSES[m.status]} | ${open} | ${summary} |`;
  });
  const head = ['| Milestone | Status | Open checks | In short |', '| --- | --- | --: | --- |'];
  return [...head, ...rows].join('\n');
}

/** The unticked items of a milestone's `## Open checks` section, with its `###` headings. */
function openChecks(text: string): string[] {
  const lines = text.split('\n');
  const from = lines.indexOf('## Open checks');
  if (from < 0) return [];
  const out: string[] = [];
  let item: string[] | null = null;
  let heading: string | null = null;
  const flush = () => {
    if (item) out.push(item.join('\n'));
    item = null;
  };
  for (const line of lines.slice(from + 1)) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('### ')) {
      flush();
      heading = line;
    } else if (/^- \[[ xX]\] /.test(line)) {
      flush();
      if (line.startsWith('- [ ] ')) {
        if (heading) out.push(heading);
        heading = null;
        item = [line];
      }
    } else if (item && (line.startsWith('  ') || line === '')) {
      if (line) item.push(line);
    } else {
      flush();
    }
  }
  flush();
  return out;
}

/** Prints open checks by milestone; `--adb` or `--you` keeps only checks with that tag. */
function printChecks(tag: string | null) {
  let total = 0;
  for (const m of readMilestones()) {
    const kept = m.checks.filter((c, i, all) => {
      if (!tag) return true;
      if (!c.startsWith('### ')) return c.startsWith(`- [ ] (${tag})`);
      const next = all.slice(i + 1).find((d) => !d.startsWith('### '));
      return next?.startsWith(`- [ ] (${tag})`) ?? false;
    });
    const count = countChecks(kept);
    if (!count) continue;
    total += count;
    console.log(`\n## M${m.n} ${m.title} (${join(MILESTONES, m.file)}, ${count})\n`);
    for (const c of kept) console.log(c.startsWith('### ') ? `\n${c}\n` : c);
  }
  console.log(`\n${total} open checks${tag ? ` tagged (${tag})` : ''}.`);
}

/** The top-level `- ` items of a `## {name}` section. */
function sectionItems(text: string, name: string): string[] {
  const lines = text.split('\n');
  const from = lines.indexOf(`## ${name}`);
  if (from < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(from + 1)) {
    if (line.startsWith('## ')) break;
    if (line.startsWith('- ')) out.push(line.slice(2).trim());
  }
  return out;
}

/** Every milestone as JSON: what the roadmap-status skill draws its overview from. */
function printStatus() {
  const milestones = readMilestones().map((m) => {
    const open = m.checks.filter((c) => c.startsWith('- [ ]'));
    const body = m.text.split('\n## ')[0] ?? '';
    return {
      n: m.n,
      title: m.title,
      status: m.status,
      summary: m.summary,
      prs: m.prs,
      file: join(MILESTONES, m.file),
      items: body.split('\n').filter((l) => l.startsWith('- ')).length,
      checks: {
        adb: open.filter((c) => c.startsWith('- [ ] (adb)')).length,
        you: open.filter((c) => c.startsWith('- [ ] (you)')).length,
      },
      openQuestions: sectionItems(m.text, 'Open questions'),
      leftOut: sectionItems(m.text, 'Left out').length,
    };
  });
  console.log(JSON.stringify({ milestones }, null, 2));
}

if (process.argv.includes('status')) {
  try {
    printStatus();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes('checks')) {
  const tag = process.argv.includes('--adb')
    ? 'adb'
    : process.argv.includes('--you')
      ? 'you'
      : null;
  try {
    printChecks(tag);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  process.exit(0);
}

const check = process.argv.includes('--check');
const current = readFileSync(ROADMAP, 'utf8');
const start = current.indexOf(START);
const end = current.indexOf(END);
if (start < 0 || end < start) {
  console.error(`${ROADMAP} needs ${START} and ${END} around the table.`);
  process.exit(1);
}

let next: string;
try {
  const body = `${START}\n\n${table(readMilestones())}\n\n`;
  const draft = current.slice(0, start) + body + current.slice(end);
  const options = await prettier.resolveConfig(ROADMAP);
  next = await prettier.format(draft, { ...options, filepath: ROADMAP });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (next === current) {
  if (!check) console.log(`${ROADMAP} is up to date.`);
} else if (check) {
  console.error(`${ROADMAP} is out of date with docs/milestones. Run pnpm roadmap.`);
  process.exit(1);
} else {
  writeFileSync(ROADMAP, next);
  console.log(`Wrote ${ROADMAP}.`);
}
