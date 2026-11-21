import initSqlJs from 'sql.js';

import type { Sql, SqlValue } from '../src/store';

const SQL = await initSqlJs();

/** The Durable Object's `sql.exec(...).toArray()`, on sql.js in memory. */
export function memorySql(): Sql {
  const db = new SQL.Database();
  return (query, ...params) => {
    const statement = db.prepare(query);
    statement.bind(params.map((p) => (p instanceof ArrayBuffer ? new Uint8Array(p) : p)));
    const rows: Record<string, SqlValue>[] = [];
    while (statement.step()) rows.push(statement.getAsObject() as Record<string, SqlValue>);
    statement.free();
    return rows;
  };
}
