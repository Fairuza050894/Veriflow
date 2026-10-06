"use client";

import { useState } from "react";
import { MermaidView } from "./mermaid-view";

type Diagram = { id: string; kind: string; title: string; source: string; status: string; audience: string; in_email: number; node_count: number; alt_text: string | null };
type Coverage = { node_id: string; kind: string; tests_total: number; passed: number; failed: number; flaky: number; state: string };

const STATE_STYLE: Record<string, { color: string; badge: string }> = {
  passed: { color: "#22c55e", badge: "✔ lulus semua" },
  failed: { color: "#ef4444", badge: "✖ ada gagal" },
  flaky: { color: "#eab308", badge: "~ flaky" },
  untested: { color: "#64748b", badge: "0 test" },
};

/**
 * §18.9 — viewer interaktif: tab per diagram, toggle layer cakupan,
 * panel detail node. Implementasi sengaja minimal: SVG + state React.
 * ponytail: tanpa d3-zoom; pan/zoom native browser + ctrl+scroll.
 * Tambah d3-zoom bila model > 150 node dan navigasi jadi bottleneck.
 */
export function ArchitectureView({ diagrams, coverage }: { diagrams: Diagram[]; coverage: Coverage[] }) {
  const ok = diagrams.filter((d) => d.status === "ok");
  const [active, setActive] = useState(ok[0]?.kind ?? diagrams[0]?.kind);
  const [audience, setAudience] = useState<"internal" | "customer">("internal");
  const [selected, setSelected] = useState<string | null>(null);
  const [showCoverage, setShowCoverage] = useState(true);

  const current = diagrams.find((d) => d.kind === active);
  const covered = coverage.filter((c) => c.tests_total > 0);
  const untested = coverage.filter((c) => c.tests_total === 0).slice(0, 12);

  if (!current) return <p className="px-5 pb-5 text-xs text-slate-500">Diagram belum tersedia — ekstraksi arsitektur mungkin dilewati.</p>;

  return (
    <div className="px-5 pb-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        {diagrams.map((d) => (
          <button
            key={d.id}
            onClick={() => setActive(d.kind)}
            className={`chip transition ${d.kind === active ? "border-dispatch text-dispatch bg-dispatch/10" : "text-slate-400 hover:text-slate-200"}`}
            title={d.status === "skipped" ? "Diagram dilewati" : undefined}
          >
            <span className="mono">{d.kind}</span> {d.title.slice(0, 28)}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} className="accent-amber-glow" />
            layer cakupan
          </label>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as "internal" | "customer")}
            className="rounded-md border border-slate-700 bg-night-900 px-2 py-1 text-[11px] text-slate-300"
          >
            <option value="internal">audiens: internal</option>
            <option value="customer">audiens: customer</option>
          </select>
        </span>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_280px]">
        <div>
          {current.status === "skipped" ? (
            <div className="rounded-xl border border-hold/30 bg-hold/5 p-4 text-xs text-hold">
              Diagram {current.kind} dilewati: {current.alt_text ?? "tidak diketahui"}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-700/60 bg-white">
              <MermaidView code={current.source} id={current.kind} />
            </div>
          )}

          {/* Legenda: tidak hanya warna (FR-DGM-09) */}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            {Object.entries(STATE_STYLE).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-sm" style={{ background: v.color, opacity: k === "untested" ? 0.5 : 1 }} />
                {v.badge}
              </span>
            ))}
            <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-slate-400" /> inferred (bukan bukti)</span>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">Sumber diagram-as-code (.mmd)</summary>
            <pre className="mono mt-2 max-h-64 overflow-auto rounded-lg border border-slate-700/60 bg-night-900 p-3 text-[11px] text-slate-400">{current.source}</pre>
          </details>
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-slate-700/60 bg-night-900/70 p-3">
            <p className="kpi-label">Cakupan ({audience === "customer" ? "ringkas" : "lengkap"})</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center">
              {(["passed", "failed", "flaky", "untested"] as const).map((s) => (
                <div key={s} className="rounded-lg border border-slate-800 bg-night-850 p-2">
                  <div className="text-lg font-semibold" style={{ color: STATE_STYLE[s].color }}>
                    {coverage.filter((c) => c.state === s).length}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{s}</div>
                </div>
              ))}
            </div>
          </div>

          {showCoverage && covered.length ? (
            <div className="rounded-xl border border-slate-700/60 bg-night-900/70 p-3">
              <p className="kpi-label">Node ter-cover</p>
              <ul className="mt-2 max-h-56 space-y-1 overflow-auto">
                {covered.map((c) => (
                  <li key={c.node_id}>
                    <button
                      onClick={() => setSelected(c.node_id)}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] transition hover:bg-white/5 ${selected === c.node_id ? "bg-dispatch/10" : ""}`}
                    >
                      <span className="mono truncate text-slate-300">{c.node_id}</span>
                      <span className="chip shrink-0" style={{ color: STATE_STYLE[c.state]?.color, borderColor: `${STATE_STYLE[c.state]?.color}55` }}>
                        {c.passed}/{c.tests_total}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {selected ? (
            <div className="rounded-xl border border-dispatch/30 bg-dispatch/[0.05] p-3 text-[11px]">
              <p className="mono text-slate-200">{selected}</p>
              <p className="mt-1 text-slate-400">
                {coverage.find((c) => c.node_id === selected)?.tests_total ?? 0} test · {coverage.find((c) => c.node_id === selected)?.passed ?? 0} lulus
              </p>
              <button className="mt-2 text-dispatch hover:underline" onClick={() => setSelected(null)}>tutup</button>
            </div>
          ) : null}

          {untested.length ? (
            <div className="rounded-xl border border-hold/25 bg-hold/[0.04] p-3">
              <p className="kpi-label text-hold">Node tanpa test</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px]">
                {untested.map((c) => <li key={c.node_id} className="mono truncate text-slate-400">{c.node_id}</li>)}
              </ul>
              <p className="mt-2 text-[10px] text-slate-500">
                Jalankan run dengan mode REPORT_ONLY→FULL_AUTO untuk menutup celah ini, atau klik node “Minta AI buat test” di viewer.
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}