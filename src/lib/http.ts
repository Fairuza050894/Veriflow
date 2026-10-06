import { NextResponse } from "next/server";

/** Error format RFC 7807 (Arsitektur §7). Dipisah dari route agar export route tetap valid untuk Next. */
export function problem(status: number, detail: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { type: `https://veriflow.dev/problems/${detail.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title: detail, status, detail, ...extra },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

export const badRequest = (d: string) => problem(400, d);
export const notFound = (d = "Resource tidak ditemukan") => problem(404, d);
export const unprocessable = (d: string) => problem(422, d);