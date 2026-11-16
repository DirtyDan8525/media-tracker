/**
 * Wraps a D1 binding and counts the queries a request runs, as D1 bills them against the
 * 50-per-invocation limit: every `first`/`all`/`run`/`raw` is one, and every statement inside a
 * `batch` is one. Also records the largest number of bound parameters seen on one statement.
 */
export interface D1Spy {
  db: D1Database;
  queries: number;
  maxParams: number;
  /** Every bound statement: its SQL and values, in bind order. */
  binds: { sql: string; values: unknown[] }[];
  /** Runs before each batch is forwarded (e.g. to simulate a concurrent write). */
  beforeBatch?: (n: number) => Promise<void>;
  reset(): void;
}

export function spyD1(real: D1Database): D1Spy {
  const spy: D1Spy = {
    db: undefined as unknown as D1Database,
    queries: 0,
    maxParams: 0,
    binds: [],
    reset() { spy.queries = 0; spy.maxParams = 0; spy.binds = []; },
  };
  let batches = 0;
  const wrap = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement => {
    for (const m of ['first', 'all', 'run', 'raw'] as const) {
      const orig = (stmt[m] as (...a: unknown[]) => unknown).bind(stmt);
      (stmt as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => { spy.queries++; return orig(...a); };
    }
    const bind = stmt.bind.bind(stmt);
    stmt.bind = (...values: unknown[]) => {
      spy.maxParams = Math.max(spy.maxParams, values.length);
      spy.binds.push({ sql, values });
      return wrap(bind(...values), sql);
    };
    return stmt;
  };
  spy.db = new Proxy(real, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
      if (prop === 'batch') {
        return async (stmts: D1PreparedStatement[]) => {
          spy.queries += stmts.length;
          if (spy.beforeBatch) await spy.beforeBatch(++batches);
          return target.batch(stmts);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return spy;
}
