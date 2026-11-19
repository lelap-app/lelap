import {
  type CheckFetch,
  type CheckOptions,
  type CheckReport,
  checkAddon,
  formatReport,
  manifestUrlOf,
} from './check';
import { CONTENT_TYPES, type ContentType } from './protocol';

/** Exit codes: 0 passed, 1 the add-on has problems, 2 the command was used wrongly. */
export const EXIT = { ok: 0, problems: 1, usage: 2 } as const;

export const USAGE = `Usage: lelap-sdk check <address> [options]

Checks a Lelap add-on against protocol v1 and says what is wrong.
<address> is the add-on's manifest URL, with or without manifest.json.

Options:
  --json             Print the report as JSON.
  --strict           Fail on warnings too.
  --items <n>        Items per catalog to check meta and streams for (default 2).
  --pages <n>        Catalog pages to follow through skip (default 3).
  --search <text>    Text for catalogs that need a search (default "the").
  --id <type:id>     Also check this item, such as audiobook:example:raven. Repeatable.
  --series <name>    A series for the series resource, as name or name/author.
  --audio            Also ask for the first bytes of each checked stream.
  --timeout <ms>     Give up on an answer after this long (default 10000, as the app).
  --help             Show this.

Exit codes: 0 passed, 1 problems found, 2 wrong use.
`;

export type CliIo = {
  write: (text: string) => void;
  fetch?: CheckFetch;
};

type Parsed = { url: string; json: boolean; strict: boolean; options: CheckOptions };

function parseArgs(args: string[]): Parsed | string {
  const [command, ...rest] = args;
  if (command !== 'check') return command ? `Unknown command: ${command}` : 'Missing command.';
  let url: string | undefined;
  let json = false;
  let strict = false;
  const options: CheckOptions = {};
  const ids: { type: ContentType; id: string }[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] ?? '';
    const value = () => {
      const next = rest[i + 1];
      i += 1;
      return next;
    };
    const count = (name: string, least: number): number | string => {
      const raw = value();
      const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
      return Number.isInteger(n) && n >= least ? n : `${name} takes a whole number from ${least}.`;
    };
    switch (arg) {
      case '--json':
        json = true;
        break;
      case '--strict':
        strict = true;
        break;
      case '--audio':
        options.audio = true;
        break;
      case '--items':
      case '--pages':
      case '--timeout': {
        const n = count(arg, arg === '--timeout' ? 1 : 0);
        if (typeof n === 'string') return n;
        if (arg === '--items') options.items = n;
        else if (arg === '--pages') options.pages = n;
        else options.timeoutMs = n;
        break;
      }
      case '--search': {
        const text = value();
        if (!text) return '--search takes a text.';
        options.search = text;
        break;
      }
      case '--id': {
        const raw = value() ?? '';
        const at = raw.indexOf(':');
        const type = raw.slice(0, at);
        if (at < 0 || !(CONTENT_TYPES as readonly string[]).includes(type) || !raw.slice(at + 1))
          return `--id takes type:id, such as audiobook:example:raven; got ${raw || 'nothing'}.`;
        ids.push({ type: type as ContentType, id: raw.slice(at + 1) });
        break;
      }
      case '--series': {
        const raw = value() ?? '';
        // The author follows the last slash, so a series name may hold one.
        const at = raw.lastIndexOf('/');
        const name = (at < 0 ? raw : raw.slice(0, at)).trim();
        const author = at < 0 ? '' : raw.slice(at + 1).trim();
        if (!name) return '--series takes a name, or name/author, such as "Dune/Frank Herbert".';
        options.series = author ? { name, author } : { name };
        break;
      }
      default:
        if (arg.startsWith('--')) return `Unknown option: ${arg}`;
        if (url) return 'Give one address.';
        url = arg;
    }
  }
  if (!url) return 'Missing the add-on address.';
  if (ids.length > 0) options.ids = ids;
  return { url, json, strict, options };
}

/** Runs `lelap-sdk` with its arguments (without `node` and the script) and returns the exit code. */
export async function runCli(args: string[], io: CliIo): Promise<number> {
  const first = args[0];
  if (first === undefined || first === '--help' || first === '-h' || args[1] === '--help') {
    io.write(USAGE);
    return first === undefined ? EXIT.usage : EXIT.ok;
  }
  const parsed = parseArgs(args);
  if (typeof parsed === 'string') {
    io.write(`${parsed}\n\n${USAGE}`);
    return EXIT.usage;
  }
  if (!manifestUrlOf(parsed.url)) {
    io.write(`Not an add-on address: ${parsed.url}\n\n${USAGE}`);
    return EXIT.usage;
  }
  let report: CheckReport;
  try {
    report = await checkAddon(parsed.url, {
      ...parsed.options,
      ...(io.fetch ? { fetch: io.fetch } : {}),
    });
  } catch (error) {
    io.write(`The check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.problems;
  }
  io.write(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  const failed = !report.ok || (parsed.strict && report.warnings > 0);
  return failed ? EXIT.problems : EXIT.ok;
}
