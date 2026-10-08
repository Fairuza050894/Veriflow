import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { neon, neonConfig, Pool } from "@neondatabase/serverless";

// Neon serverless driver (untuk raw queries di prod)
neonConfig.fetchConnectionCache = true;

let _pool: Pool | null = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (_pool) return _pool;
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}

export const uid = (prefix = "") =>
  prefix + randomUUID().replaceAll("-", "").slice(0, 20);
export const nowIso = () => new Date().toISOString();
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---- SQLite (dev default) ----
let _db: DatabaseSync | null = null;

export function dbPath(): string {
  const raw = process.env.VERIFLOW_DB_PATH ?? "./.data/veriflow.db";
  const p = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

export function getDb(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(dbPath());
  _db.exec("PRAGMA busy_timeout = 10000;");
  _db.exec(readFileSync(resolve(process.cwd(), "src/lib/schema.sql"), "utf8"));
  return _db;
}

// ---- Prisma (hanya untuk migrasi/generate) ----
let _prisma: PrismaClient | null = null;
export function getPrisma(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (process.env.NODE_ENV === "development") {
    if (_prisma) return _prisma;
    _prisma = new PrismaClient({ log: ["query", "error", "warn"] });
    return _prisma;
  }
  return new PrismaClient({ log: ["error"] });
}

export function usePrisma(): boolean {
  return !!process.env.DATABASE_URL;
}



// ---- Unified Query Interface ----
type Params = Array<string | number | null>;
const transaction = new AsyncLocalStorage<{ prisma?: Prisma.TransactionClient; sqlTx?: any }>();
let sqliteQueue: Promise<unknown> = Promise.resolve();
async function sqliteAccess<T>(fn: () => T | Promise<T>): Promise<T> {
  if (transaction.getStore()) return fn();
  const pending = sqliteQueue.then(fn);
  sqliteQueue = pending.catch(() => {});
  return pending;
}
export function postgresSql(sql: string): string {
  let index = 0;
  sql = sql.replace(/json_extract\((\w+),'\$\.(\w+)'\)/gi, "($1::jsonb->>'$2')");
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?/g,
    (part) => part === "?" ? `$${++index}` : part);
}
const postgresRows = <T>(rows: unknown): T[] => {
  const arr = Array.isArray(rows) ? rows : (rows && typeof rows === "object" && "rows" in rows ? (rows as any).rows : []);
  return arr.map((row: any) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]),
  ) as T);
};
const plain = <T>(row: unknown): T => (row == null ? (row as T) : ({ ...(row as object) } as T));

export async function all<T = Record<string, any>>(sql: string, params: Params = []): Promise<T[]> {
  const store = transaction.getStore();
  if (usePrisma() && store?.sqlTx) {
    // Di dalam transaksi Neon
    const pgSql = postgresSql(sql);
    const rows = await store.sqlTx.unsafe(pgSql, params);
    return postgresRows<T>(rows);
  }
  if (usePrisma() && getPool()) {
    // Neon serverless Pool untuk raw queries
    const pool = getPool()!;
    const pgSql = postgresSql(sql);
    const result = await pool.query(pgSql, params);
    return postgresRows<T>(result.rows);
  }
  if (usePrisma() && store?.prisma) {
    return postgresRows<T>(await store.prisma.$queryRawUnsafe(postgresSql(sql), ...params));
  }
  if (usePrisma()) {
    const prisma = getPrisma()!;
    return postgresRows<T>(await prisma.$queryRawUnsafe(postgresSql(sql), ...params));
  }
  return sqliteAccess(() => (getDb().prepare(sql).all(...params) as unknown[]).map((r) => plain<T>(r)));
}

export async function one<T = Record<string, any>>(sql: string, params: Params = []): Promise<T | undefined> {
  return (await all<T>(sql, params))[0];
}

export async function run(sql: string, params: Params = []) {
  const store = transaction.getStore();
  if (usePrisma() && store?.sqlTx) {
    // Di dalam transaksi Neon
    const pgSql = postgresSql(sql);
    return store.sqlTx.unsafe(pgSql, params);
  }
  if (usePrisma() && getPool()) {
    const pool = getPool()!;
    const pgSql = postgresSql(sql);
    const result = await pool.query(pgSql, params);
    return result;
  }
  if (usePrisma() && store?.prisma) {
    return store.prisma.$executeRawUnsafe(postgresSql(sql), ...params);
  }
  if (usePrisma()) {
    const prisma = getPrisma()!;
    return prisma.$executeRawUnsafe(postgresSql(sql), ...params);
  }
  return sqliteAccess(() => getDb().prepare(sql).run(...params));
}

export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const store = transaction.getStore();
  if (store) return fn();
  if (usePrisma() && getPool()) {
    // Neon serverless: gunakan transaksi native Pool
    const pool = getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await transaction.run({
        sqlTx: {
          unsafe: (query: string, params: Params) => client.query(query, params),
        },
      }, fn);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  if (usePrisma()) {
    const prisma = getPrisma()!;
    return prisma.$transaction(async (client) => {
      return transaction.run({ prisma: client }, fn);
    }, { timeout: 30000 });
  }
  return sqliteAccess(() => transaction.run({}, async () => {
    const d = getDb();
    d.exec("BEGIN IMMEDIATE");
    try {
      const out = await fn();
      d.exec("COMMIT");
      return out;
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
  }));
}

export const J = {
  parse<T>(v: unknown, fallback: T): T {
    if (typeof v !== "string" || !v) return fallback;
    try { return JSON.parse(v) as T; } catch { return fallback; }
  },
  str: (v: unknown) => JSON.stringify(v ?? null),
};

export async function kvGet(key: string): Promise<string | undefined> {
  return (await one<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]))?.value;
}
export function kvSet(key: string, value: string) {
  return run("INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    [key, value, nowIso()]);
}

export type { PrismaClient } from "@prisma/client";