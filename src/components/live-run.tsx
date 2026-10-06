"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Step = { name: string; status: string; attempt?: number };

const LIVE_ORDER = [
  "CLONING", "ANALYZING", "SCAFFOLDING", "PLANNING", "GENERATING", "VALIDATING", "HEALING",
  "WAITING_APPROVAL", "COMMITTING", "PROVISIONING", "EXECUTING", "ANALYZING_RESULTS", "REPORTING", "NOTIFYING",
];

type LogLine = { id: number; ts: string; step: string; level: string; message: string };

/** Live run panel: stepper real-time via SSE + auto-reconnect + optimistic advance. */
export function LiveRun({ runId, steps }: { runId: string; steps: Step[] }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, Step>>(Object.fromEntries(steps.map((s) => [s.name, s])));
  const [status, setStatus] = useState<string>("RUNNING");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const es = new EventSource(`/api/v1/runs/${runId}/stream`);
      esRef.current = es;

      es.onopen = () => { setConnected(true); retry = 0; };
      es.addEventListener("run.status", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { status: string };
        setStatus(d.status);
      });
      es.addEventListener("step.snapshot", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { status: string; steps: Step[] };
        setStatus(d.status);
        setState(Object.fromEntries(d.steps.map((s) => [s.name, s])));
      });
      es.addEventListener("log.line", (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { lines: LogLine[] };
        setLogs((prev) => [...prev, ...d.lines].slice(-400));
      });
      es.addEventListener("run.completed", () => {
        setConnected(false);
        es.close();
        router.refresh();
      });
      es.onerror = () => {
        setConnected(false);
        es.close();
        // backoff: 1s, 2s, 4s ... maks 15s (state tetap durable di DB)
        const wait = Math.min(15_000, 1000 * 2 ** retry++);
        timer = setTimeout(connect, wait);
      };
    };

    connect();
    return () => {
      esRef.current?.close();
      if (timer) clearTimeout(timer);
    };
  }, [runId, router]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [logs]);

  const activeIndex = LIVE_ORDER.findIndex((n) => state[n]?.status === "running");

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-go pulse-dot" : "bg-hold"}`} />
          <span className="text-xs font-semibold text-slate-200">
            {connected ? "Live — SSE terhubung" : "Menyambung ulang…"}
          </span>
          <span className="chip text-slate-400">{status.replace(/_/g, " ")}</span>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => router.refresh()}>↻ Refresh</button>
          <button className="btn btn-ghost px-2.5 py-1 text-xs"
            onClick={async () => { await fetch(`/api/v1/runs/${runId}/cancel`, { method: "POST" }); router.refresh(); }}>
            Batalkan
          </button>
        </div>
      </div>

      {/* Stepper */}
      <ol className="flex gap-1 overflow-x-auto px-4 py-3">
        {LIVE_ORDER.map((name, i) => {
          const st = state[name]?.status ?? "pending";
          const isActive = st === "running";
          return (
            <li key={name} className="flex min-w-[112px] flex-1 flex-col gap-1">
              <div className={`relative h-1.5 rounded-full overflow-hidden ${
                st === "succeeded" ? "bg-go/70" : st === "running" ? "bg-night-700" : st === "failed" ? "bg-stop/70" : st === "skipped" ? "bg-slate-600" : "bg-night-700"
              }`}>
                {isActive ? <div className="sweep absolute inset-0 bg-dispatch/40" /> : null}
              </div>
              <div className="flex items-center gap-1">
                <span className="mono text-[10px] text-slate-600">{String(i + 1).padStart(2, "0")}</span>
                <span className={`truncate text-[10px] font-semibold ${isActive ? "text-dispatch" : st === "succeeded" ? "text-slate-400" : "text-slate-600"}`}>
                  {name}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Log */}
      <div ref={boxRef} className="max-h-56 overflow-auto border-t border-slate-800 bg-night-950/60 px-4 py-3">
        {logs.length === 0 ? (
          <p className="text-[11px] text-slate-600">Menunggu log dari pipeline…</p>
        ) : (
          <ol className="space-y-0.5 font-mono text-[11px]">
            {logs.map((l) => (
              <li key={l.id} className="flex gap-2">
                <span className="shrink-0 text-slate-700">{String(l.ts).slice(11, 19)}</span>
                <span className={`shrink-0 ${l.level === "error" ? "text-stop" : l.level === "warn" ? "text-hold" : "text-dispatch/70"}`}>
                  [{l.step}]
                </span>
                <span className="text-slate-400">{l.message}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {activeIndex >= 0 ? (
        <div className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">
          Tahap aktif: <span className="mono text-dispatch">{LIVE_ORDER[activeIndex]}</span> · timeout &amp; retry mengikuti tabel di <code className="mono">src/lib/types.ts</code>
        </div>
      ) : null}
    </div>
  );
}