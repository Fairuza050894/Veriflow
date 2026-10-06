import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

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

export function getPrisma(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (_prisma) return _prisma;
  _prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
  return _prisma;
}

/** Cek apakah pakai Prisma (Postgres) atau SQLite */
export function usePrisma(): boolean {
  return !!process.env.DATABASE_URL;
}

// ---- Unified Query Interface ----
type Params = Array<string | number | null>;
/** node:sqlite mengembalikan baris ber-prototype null; Next menolak kirimnya ke Client Component. Normalkan sekali di sini. */
const plain = <T>(row: unknown): T => (row == null ? (row as T) : ({ ...(row as object) } as T));

export async function all<T = Record<string, any>>(sql: string, params: Params = []): Promise<T[]> {
  if (usePrisma()) {
    const prisma = getPrisma()!;
    return prisma.$queryRawUnsafe(sql, ...params) as Promise<T[]>;
  }
  return (getDb().prepare(sql).all(...params) as unknown[]).map((r) => plain<T>(r));
}

export async function one<T = Record<string, any>>(sql: string, params: Params = []): Promise<T | undefined> {
  if (usePrisma()) {
    const prisma = getPrisma()!;
    const rows = await prisma.$queryRawUnsafe(sql, ...params) as T[];
    return rows[0];
  }
  const row = getDb().prepare(sql).get(...params);
  return row == null ? undefined : plain<T>(row);
}

export async function run(sql: string, params: Params = []) {
  if (usePrisma()) {
    const prisma = getPrisma()!;
    return prisma.$executeRawUnsafe(sql, ...params);
  }
  return getDb().prepare(sql).run(...params);
}

/** Jalankan dalam transaksi; dipakai untuk idempotency & `exactly-once` efek eksternal. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (usePrisma()) {
    const prisma = getPrisma()!;
    return prisma.$transaction(fn);
  }
  const d = getDb();
  d.exec("BEGIN");
  try {
    const out = await fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export const J = {
  parse<T>(v: unknown, fallback: T): T {
    if (typeof v !== "string" || !v) return fallback;
    try { return JSON.parse(v) as T; } catch { return fallback; }
  },
  str: (v: unknown) => JSON.stringify(v ?? null),
};

export function kvGet(key: string): string | undefined {
  // For Prisma, use raw query
  return (one<{ value: string }>("SELECT value FROM kv WHERE key = ?", [key]) as any)?.value;
}
export function kvSet(key: string, value: string) {
  run("INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
    [key, value, nowIso()]);
}

// Export Prisma types for convenience
export type { PrismaClient } from "@prisma/client";