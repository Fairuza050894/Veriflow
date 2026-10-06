import { createHash } from "node:crypto";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** RNG deterministik dari seed string — run yang sama selalu menghasilkan hasil sama. */
export function rng(seed: string) {
  let h = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function fmtDuration(ms: number): string {
  if (!ms) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const fmtPct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;

export function fmtDate(iso: string | null | undefined, locale = "id-ID"): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function fmtMoney(usd: number): string {
  return usd < 0.01 ? `<$0.01` : `$${usd.toFixed(2)}`;
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function shortSha(s: string): string {
  return s ? s.slice(0, 7) : "—";
}

/** Ambil baris ke-n dari teks (1-indexed) untuk bukti evidence. */
export function lineOf(text: string, needle: string): number | undefined {
  const i = text.split("\n").findIndex((l) => l.includes(needle));
  return i >= 0 ? i + 1 : undefined;
}

export function repoNameFromUrl(url: string): string {
  const m = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/i);
  return m ? m[1].split("/").pop()! : url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}