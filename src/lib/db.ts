import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";

export const uid = (prefix = "") =>
  prefix + randomUUID().replaceAll("-", "").slice(0, 20);
export const nowIso = () => new Date().toISOString();
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---- SQLite (current, default) ----
let _db: DatabaseSync | null = null;

/**
 * Lokasi DB:
 *  - default dev: ./.data/veriflow.db (persisten)
 *  - Vercel: set VERIFLOW_DB_PATH=/tmp/veriflow.db (ephemeral)
 *  - Produksi: set DATABASE_URL untuk Prisma/Postgres
 */
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

// ---- Prisma (Postgres/Neon) ----
let _prisma: PrismaClient | null = null;

/** Per-request PrismaClient untuk serverless (Neon pooled).
 * Di dev: singleton. Di prod (Vercel): new client per invocation. */
export function getPrisma(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (process.env.NODE_ENV === "development") {
    if (_prisma) return _prisma;
    _prisma = new PrismaClient({
      log: ["query", "error", "warn"],
    });
    return _prisma;
  }
  // Production serverless: new client per request, auto-disconnect
  return new PrismaClient({
    log: ["error"],
  });
}

/** Cek apakah pakai Prisma (Postgres) atau SQLite */
export function usePrisma(): boolean {
  return !!process.env.DATABASE_URL;
}

// ---- Unified Query Interface ----
type Params = Array<string | number | null>;
const transaction = new AsyncLocalStorage<{ prisma?: Prisma.TransactionClient }>();
let sqliteQueue: Promise<unknown> = Promise.resolve();
async function sqliteAccess<T>(fn: () => T | Promise<T>): Promise<T> {
  if (transaction.getStore()) return fn();
  const pending = sqliteQueue.then(fn);
  sqliteQueue = pending.catch(() => {});
  return pending;
}
// SQL uses positional parameters; quoted strings/comments must stay untouched.
export function postgresSql(sql: string): string {
  let index = 0;
  sql = sql.replace(/json_extract\((\w+),'\$\.(\w+)'\)/gi, "($1::jsonb->>'$2')");
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?/g,
    (part) => part === "?" ? `$${++index}` : part);
}
const postgresRows = <T>(rows: unknown[]): T[] => rows.map((row) => Object.fromEntries(
  Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value]),
) as T);
/** node:sqlite mengembalikan baris ber-prototype null; Next menolak kirimnya ke Client Component. Normalkan sekali di sini. */
const plain = <T>(row: unknown): T => (row == null ? (row as T) : ({ ...(row as object) } as T));

export async function all<T = Record<string, any>>(sql: string, params: Params = []): Promise<T[]> {
  if (usePrisma()) {
    const prisma = transaction.getStore()?.prisma ?? getPrisma()!;
    return postgresRows<T>(await prisma.$queryRawUnsafe(postgresSql(sql), ...params));
  }
  return sqliteAccess(() => (getDb().prepare(sql).all(...params) as unknown[]).map((r) => plain<T>(r)));
}

export async function one<T = Record<string, any>>(sql: string, params: Params = []): Promise<T | undefined> {
  return (await all<T>(sql, params))[0];
}

export async function run(sql: string, params: Params = []) {
  if (usePrisma()) {
    const prisma = transaction.getStore()?.prisma ?? getPrisma()!;
    return prisma.$executeRawUnsafe(postgresSql(sql), ...params);
  }
  return sqliteAccess(() => getDb().prepare(sql).run(...params));
}

/** Jalankan dalam transaksi; dipakai untuk idempotency & `exactly-once` efek eksternal. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (transaction.getStore()) return fn();
  if (usePrisma()) {
    const prisma = getPrisma()!;
    // Neon serverless: skip advisory lock (P2028 on pooled connections)
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

// Export Prisma types for convenience
export type { PrismaClient } from "@prisma/client";
