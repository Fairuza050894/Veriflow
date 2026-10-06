import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHead, StatusChip, CategoryChip, EmptyState } from "@/components/ui";
import { LiveRun } from "@/components/live-run";
import { ArchitectureView } from "@/components/architecture-view";
import { runDetail } from "@/lib/queries";
import { fmtPct, fmtDuration, fmtMoney, fmtDate, fmtNum, shortSha } from "@/lib/util";
import { J } from "@/lib/db";
import type { RunSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = runDetail(id);
  if (!r) notFound();

  const summary = r.summary as RunSummary | null;
  const terminal = ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED", "TIMED_OUT"].includes(String(r.status));
  const token = J.parse<{ token?: string }>("{}", {});
  void token;

  const pr = r.pr;
  const diagrams = (r.diagrams as Array<Record<string, any>>).map((d) => ({
    id: String(d.id), kind: String(d.kind), title: String(d.title), source: String(d.source),
    status: String(d.status), audience: String(d.audience), in_email: Number(d.in_email),
    node_count: Number(d.node_count), alt_text: (d.alt_text as string) ?? null,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Run #{String(r.id).slice(-6)}</h1>
            <StatusChip status={String(r.status)} />
          </div>
          <p className="mono mt-1 text-xs text-slate-500">
            <Link href={`/projects/${r.project_id}`} className="text-slate-300 hover:text-dispatch">{r.project_name}</Link>
            {" · "}{r.env_name ?? "default"}{" · "}{r.branch}@{shortSha(String(r.commit_sha))}{" · "}trigger {r.trigger}
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Mulai {fmtDate(r.started_at, "id-ID")} · Selesai {fmtDate(r.finished_at, "id-ID")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pr ? (
            <a className="btn btn-ghost" href={pr.url} target="_blank" rel="noreferrer">{t_label("Pull Request")} #{pr.number}</a>
          ) : null}
          {r.report_url ? (
            <Link className="btn btn-ghost" href={r.report_url as string} target="_blank">Report publik</Link>
          ) : null}
        </div>
      </div>

      {!terminal ? <LiveRun runId={String(r.id)} steps={r.steps as unknown as Array<{ name: string; status: string }>} /> : null}

      {/* Kartu hasil */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Result label="Total" value={fmtNum(summary?.total ?? 0)} />
        <Result label="Lulus" value={fmtNum(summary?.passed ?? 0)} color="#22c55e" />
        <Result label="Gagal" value={fmtNum(summary?.failed ?? 0)} color={summary?.failed ? "#ef4444" : "#64748b"} />
        <Result label="Flaky" value={fmtNum(summary?.flaky ?? 0)} color={summary?.flaky ? "#eab308" : "#64748b"} />
        <Result label="Pass rate" value={summary ? fmtPct(summary.pass_rate, 1) : "—"} color="#22d3ee" />
        <Result label="Durasi" value={fmtDuration(summary?.duration_ms ?? 0)} color="#f59e0b" />
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="kpi-label">AI cost</p>
          <p className="mt-1 text-xl font-semibold text-slate-50">{fmtMoney(Number(r.cost?.cost_usd ?? 0))}</p>
          <p className="mono text-[11px] text-slate-500">{fmtNum(Number(r.cost?.tokens_in ?? 0))} in / {fmtNum(Number(r.cost?.tokens_out ?? 0))} out · {r.cost?.ai_calls ?? 0} calls</p>
        </Card>
        <Card className="p-4">
          <p className="kpi-label">Runner seconds</p>
          <p className="mt-1 text-xl font-semibold text-slate-50">{fmtNum(Number(r.cost?.runner_seconds ?? 0))}s</p>
        </Card>
        <Card className="p-4 lg:col-span-2">
          <p className="kpi-label">Kategori kegagalan</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Object.entries(summary?.categories ?? {}).length
              ? Object.entries(summary!.categories).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5"><CategoryChip category={k} /><span className="mono text-xs text-slate-400">{v}</span></span>
              ))
              : <span className="text-xs text-slate-500">Tidak ada kegagalan tercatat.</span>}
          </div>
        </Card>
      </div>

      {/* Log + shards */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title="Log pipeline" sub="Tersimpan di DB; dapat diaudit" />
          <div className="max-h-80 overflow-auto px-5 pb-5">
            <ol className="space-y-1 font-mono text-[11px]">
              {(r.logs as Array<{ ts: string; step: string; level: string; message: string }>).map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 text-slate-600">{String(l.ts).slice(11, 19)}</span>
                  <span className={`shrink-0 ${l.level === "error" ? "text-stop" : l.level === "warn" ? "text-hold" : "text-slate-500"}`}>[{l.step}]</span>
                  <span className="text-slate-300">{l.message}</span>
                </li>
              ))}
            </ol>
          </div>
        </Card>

        <Card>
          <CardHead title="Step timeline" sub="Durable per step" />
          <ol className="space-y-1.5 px-5 pb-5">
            {(r.steps as Array<{ name: string; status: string; attempt: number; detail: string | null; started_at: string | null; finished_at: string | null }>).map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-xs">
                <span className={`h-1.5 w-1.5 rounded-full ${
                  s.status === "succeeded" ? "bg-go" : s.status === "failed" ? "bg-stop" : s.status === "running" ? "bg-dispatch pulse-dot" : s.status === "skipped" || s.status === "cancelled" ? "bg-slate-600" : "bg-slate-700"
                }`} />
                <span className="mono text-slate-300">{s.name}</span>
                <span className="ml-auto text-[11px] text-slate-500">{s.status}{s.attempt > 1 ? ` ×${s.attempt}` : ""}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* Shards */}
      {r.shards.length ? (
        <Card>
          <CardHead title="Sharding & progress" sub={`${r.shards.length} shard · bin-packing berbasis durasi historis`} />
          <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
            {(r.shards as Array<{ index: number; total: number; testIds: string[]; estimatedMs: number }>).map((s) => {
              const results = (r.tests as Array<{ file: string; status: string }>);
              const done = (r.logs as Array<{ message: string }>).filter((l) => l.message.includes(`shard ${s.index}/${s.total}`)).length;
              const pctBar = Math.min(100, Math.round((done / Math.max(1, s.testIds.length)) * 100));
              void results;
              return (
                <div key={s.index} className="rounded-lg border border-slate-700/60 bg-night-900/60 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="mono font-semibold text-slate-200">S{s.index}</span>
                    <span className="text-[11px] text-slate-500">{s.testIds.length} test · {fmtDuration(s.estimatedMs)}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-night-700">
                    <div className="h-full rounded-full bg-gradient-to-r from-dispatch to-amber-glow" style={{ width: `${pctBar}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* Test explorer */}
      <Card>
        <CardHead title="Test explorer" sub={`${(r.tests as unknown[]).length} test pada run ini`} right={<Link href={`/tests?run=${r.id}`} className="btn btn-ghost text-xs">Buka penuh</Link>} />
        {(r.tests as unknown[]).length ? (
          <div className="max-h-96 overflow-auto px-2 pb-4">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-night-900/95 backdrop-blur">
                <tr className="kpi-label border-b border-slate-700/50">
                  <th className="px-3 py-2">Test</th>
                  <th className="px-3 py-2">Layer</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Durasi</th>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2">Covers</th>
                </tr>
              </thead>
              <tbody>
                {(r.tests as Array<{ id: string; title: string; file: string; layer: string; status: string; duration_ms: number; error_category: string | null; covers: string[] }>).map((tr) => (
                  <tr key={tr.id} className="border-b border-slate-800/60 hover:bg-white/[0.03]">
                    <td className="px-3 py-2">
                      <span className="text-slate-200">{tr.title}</span>
                      <div className="mono text-[10px] text-slate-600">{tr.file}</div>
                    </td>
                    <td className="px-3 py-2"><span className="chip text-slate-400">{tr.layer}</span></td>
                    <td className="px-3 py-2"><StatusChip status={tr.status} pulse={false} /></td>
                    <td className="mono px-3 py-2 text-slate-400">{fmtDuration(tr.duration_ms)}</td>
                    <td className="px-3 py-2"><CategoryChip category={tr.error_category} /></td>
                    <td className="mono max-w-[220px] truncate px-3 py-2 text-[10px] text-slate-500">{tr.covers.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Belum ada hasil test" hint="Hasil muncul setelah tahap EXECUTING." />}
      </Card>

      {/* Arsitektur */}
      {diagrams.length ? (
        <Card>
          <CardHead
            title="Repo intelligence & diagram"
            sub={r.snapshot ? `snapshot ${(r.snapshot as any).id} · ${(r.snapshot as any).node_count} node · ${(r.snapshot as any).edge_count} edge` : undefined}
            right={<Link href={`/architecture?run=${r.id}`} className="btn btn-ghost text-xs">Viewer penuh</Link>}
          />
          <ArchitectureView diagrams={diagrams} coverage={r.coverage as never} />
        </Card>
      ) : null}

      {/* Temuan */}
      {(r.findings as unknown[]).length || (r.devops as unknown[]).length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHead title="Temuan arsitektur" sub="Aturan deterministik, selalu ada bukti file:baris" />
            <ul className="space-y-2 px-5 pb-5">
              {(r.findings as Array<{ code: string; severity: string; detail: string; evidence: string }>).map((f) => (
                <li key={f.code} className="rounded-lg border border-slate-700/60 bg-night-900/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`chip ${f.severity === "high" ? "text-stop" : f.severity === "medium" ? "text-hold" : "text-slate-400"}`}>{f.severity}</span>
                    <span className="mono text-[11px] text-slate-400">{f.code}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-200">{f.detail}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHead title="DevOps health" sub="Analisis statis dari repo (bukan infra berjalan)" />
            <ul className="space-y-2 px-5 pb-5">
              {(r.devops as Array<{ tool: string; severity: string; rule: string; location: string; message: string }>).map((f, i) => (
                <li key={i} className="rounded-lg border border-slate-700/60 bg-night-900/60 p-3">
                  <div className="flex items-center gap-2">
                    <span className="chip text-slate-300">{f.tool}</span>
                    <span className={`chip ${f.severity === "high" ? "text-stop" : "text-hold"}`}>{f.severity}</span>
                    <span className="mono ml-auto text-[10px] text-slate-600">{f.location}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-300">{f.message}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Result({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card className="p-4">
      <p className="kpi-label">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight" style={{ color: color ?? "#e2e8f0" }}>{value}</p>
    </Card>
  );
}

const t_label = (s: string) => s;