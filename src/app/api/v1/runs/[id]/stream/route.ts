import { all } from "@/lib/db";
import { notFound } from "@/lib/http";
import { advanceRun } from "@/lib/pipeline/engine";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

const TERMINAL = new Set(["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED", "TIMED_OUT"]);

/**
 * GET /api/v1/runs/{id}/stream — SSE live progress + log (FR-DSH-03).
 *
 * ponytail: engine digerakkan oleh permintaan ini. Satu tick = satu advanceRun()
 * lalu dump status. Event: run.status, step.finished, log.line, run.completed.
 * Vercel Hobby membatasi durasi fungsi serverless → 300 tick (~3 menit) per koneksi;
 * klien lalu melakukan reconnect otomatis. Durable: state ada di DB, bukan di memori.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const exists = one<{ id: string }>("SELECT id FROM runs WHERE id = ?", [id]);
  if (!exists) return notFound("Run tidak ditemukan");

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let lastLogId = one<{ id: number }>("SELECT COALESCE(MAX(id),0) id FROM run_logs WHERE run_id = ?", [id])?.id ?? 0;
      const startedAt = Date.now();
      const MAX_MS = Number(process.env.VERIFLOW_SSE_MAX_MS ?? 170_000);
      const TICK_MS = Number(process.env.VERIFLOW_SSE_TICK_MS ?? 600);

      controller.enqueue(encoder.encode(": connected\n\n"));

      while (!closed && Date.now() - startedAt < MAX_MS) {
        // 1) majukan pipeline satu langkah
        try {
          const res = await advanceRun(id);
          send("run.status", { status: res.status });
        } catch (e) {
          send("error", { message: (e as Error).message });
        }

        // 2) kirim step & log baru
        const run = one<{ status: string }>("SELECT status FROM runs WHERE id = ?", [id]);
        const steps = all<{ name: string; status: string; attempt: number; detail: string | null }>(
          "SELECT name, status, attempt, detail FROM run_steps WHERE run_id = ? ORDER BY seq", [id]);
        send("step.snapshot", {
          status: run?.status,
          steps: steps.map((s) => ({ ...s, detail: s.detail ? JSON.parse(s.detail) : null })),
        });

        const logs = all<{ id: number; step: string; level: string; message: string; ts: string }>(
          "SELECT id, step, level, message, ts FROM run_logs WHERE run_id = ? AND id > ? ORDER BY id LIMIT 60", [id, lastLogId]);
        if (logs.length) {
          lastLogId = logs[logs.length - 1].id;
          send("log.line", { lines: logs });
        }

        if (run?.status && TERMINAL.has(run.status)) {
          const summary = one<{ summary: string }>("SELECT summary FROM runs WHERE id = ?", [id])?.summary;
          send("run.completed", { status: run.status, summary: summary ? JSON.parse(summary) : null });
          closed = true;
          controller.close();
          return;
        }
        await new Promise((r) => setTimeout(r, TICK_MS));
      }

      if (!closed) {
        send("keepalive", { at: Date.now() });
        try { controller.close(); } catch { /* sudah tertutup */ }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}