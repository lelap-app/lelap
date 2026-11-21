import type { CheckResult } from './check';

/** SQLite as the Durable Object has it (`ctx.storage.sql`), or sql.js in tests. */
export type SqlValue = string | number | null | ArrayBuffer;
export type Sql = (query: string, ...params: SqlValue[]) => Record<string, SqlValue>[];

const HOUR_MS = 60 * 60_000;
/** Results are kept per hour for 7 days. */
export const KEEP_HOURS = 7 * 24;
export const BAR_HOURS = 24;

export type Hour = { start: number; checks: number; ups: number };

export type TargetStatus = {
  name: string;
  url: string;
  up: boolean;
  status: number | null;
  ms: number;
  error: string | null;
  checkedAt: number;
  /** When the current state began, as far as these results go back. */
  since: number;
  uptime24h: number | null;
  uptime7d: number | null;
  lastFailure: { at: number; status: number | null; error: string | null } | null;
  /** The last 24 hours, oldest first; hours without checks have `checks: 0`. */
  hours: Hour[];
};

export type Snapshot = { checkedAt: number; targets: TargetStatus[] };

export type Change = {
  name: string;
  url: string;
  up: boolean;
  error: string | null;
  /** How long the previous state lasted. */
  lastedMs: number;
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS hours (
    target TEXT NOT NULL, hour INTEGER NOT NULL, checks INTEGER NOT NULL, ups INTEGER NOT NULL,
    PRIMARY KEY (target, hour))`,
  `CREATE TABLE IF NOT EXISTS targets (
    name TEXT PRIMARY KEY, up INTEGER NOT NULL, since INTEGER NOT NULL,
    fail_at INTEGER, fail_status INTEGER, fail_error TEXT)`,
  `CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)`,
];

const num = (value: SqlValue | undefined): number => (typeof value === 'number' ? value : 0);
const numOrNull = (value: SqlValue | undefined): number | null =>
  typeof value === 'number' ? value : null;
const textOrNull = (value: SqlValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

export function uptime(hours: Hour[]): number | null {
  let checks = 0;
  let ups = 0;
  for (const hour of hours) {
    checks += hour.checks;
    ups += hour.ups;
  }
  return checks ? ups / checks : null;
}

export function createStore(sql: Sql) {
  for (const statement of SCHEMA) sql(statement);

  /** Keeps one run's results, prunes old ones and returns what changed state. */
  function record(results: CheckResult[], now: number): Change[] {
    const hour = Math.floor(now / HOUR_MS);
    const changes: Change[] = [];
    const states = new Map<
      string,
      { up: boolean; since: number; failure: TargetStatus['lastFailure'] }
    >();

    for (const result of results) {
      const [previous] = sql('SELECT * FROM targets WHERE name = ?', result.name);
      const wasUp = previous ? num(previous.up) === 1 : null;
      const since = previous && wasUp === result.up ? num(previous.since) : now;
      if (previous && wasUp !== result.up)
        changes.push({
          name: result.name,
          url: result.url,
          up: result.up,
          error: result.error,
          lastedMs: now - num(previous.since),
        });
      const failure = result.up
        ? previous && previous.fail_at !== null
          ? {
              at: num(previous.fail_at),
              status: numOrNull(previous.fail_status),
              error: textOrNull(previous.fail_error),
            }
          : null
        : { at: now, status: result.status, error: result.error };
      sql(
        `INSERT INTO targets (name, up, since, fail_at, fail_status, fail_error) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET up = excluded.up, since = excluded.since,
           fail_at = excluded.fail_at, fail_status = excluded.fail_status, fail_error = excluded.fail_error`,
        result.name,
        result.up ? 1 : 0,
        since,
        failure?.at ?? null,
        failure?.status ?? null,
        failure?.error ?? null,
      );
      sql(
        `INSERT INTO hours (target, hour, checks, ups) VALUES (?, ?, 1, ?)
         ON CONFLICT (target, hour) DO UPDATE SET checks = checks + 1, ups = ups + excluded.ups`,
        result.name,
        hour,
        result.up ? 1 : 0,
      );
      states.set(result.name, { up: result.up, since, failure });
    }

    // Targets taken out of the configuration leave with their history.
    const names = results.map((r) => r.name);
    const keep = names.map(() => '?').join(', ');
    sql(`DELETE FROM targets${names.length ? ` WHERE name NOT IN (${keep})` : ''}`, ...names);
    sql(
      `DELETE FROM hours WHERE hour <= ?${names.length ? ` OR target NOT IN (${keep})` : ''}`,
      hour - KEEP_HOURS,
      ...names,
    );

    const byTarget = new Map<string, Map<number, Hour>>();
    for (const row of sql('SELECT target, hour, checks, ups FROM hours')) {
      const target = String(row.target);
      const map = byTarget.get(target) ?? new Map<number, Hour>();
      map.set(num(row.hour), {
        start: num(row.hour) * HOUR_MS,
        checks: num(row.checks),
        ups: num(row.ups),
      });
      byTarget.set(target, map);
    }

    const snapshot: Snapshot = {
      checkedAt: now,
      targets: results.map((result) => {
        const state = states.get(result.name);
        const kept = byTarget.get(result.name) ?? new Map<number, Hour>();
        const last = (count: number) =>
          Array.from({ length: count }, (_, i) => {
            const h = hour - count + 1 + i;
            return kept.get(h) ?? { start: h * HOUR_MS, checks: 0, ups: 0 };
          });
        const day = last(BAR_HOURS);
        return {
          name: result.name,
          url: result.url,
          up: result.up,
          status: result.status,
          ms: result.ms,
          error: result.error,
          checkedAt: now,
          since: state?.since ?? now,
          uptime24h: uptime(day),
          uptime7d: uptime(last(KEEP_HOURS)),
          lastFailure: state?.failure ?? null,
          hours: day,
        };
      }),
    };
    sql(
      'INSERT INTO snapshot (id, body) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body',
      JSON.stringify(snapshot),
    );
    return changes;
  }

  /** What the last run found; one row read, so a page view costs almost nothing. */
  function snapshot(): Snapshot | null {
    const [row] = sql('SELECT body FROM snapshot WHERE id = 1');
    return typeof row?.body === 'string' ? (JSON.parse(row.body) as Snapshot) : null;
  }

  return { record, snapshot };
}

export type Store = ReturnType<typeof createStore>;
