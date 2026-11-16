import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

// DATE-Spalten als Text (YYYY-MM-DD) liefern, nicht als lokale Mitternacht.
pg.types.setTypeParser(1082, (v) => v);
// BIGINT (count) als Zahl
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

export async function q<T = any>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(sql, params as any[]);
  return r.rows as T[];
}

export async function one<T = any>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query(sql, params as any[]);
  return (r.rows[0] as T) ?? null;
}

export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
