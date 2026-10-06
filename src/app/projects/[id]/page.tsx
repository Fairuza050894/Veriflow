import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHead, StatusChip, EmptyState } from "@/components/ui";
import { projectById } from "@/lib/queries";
import { RunButton } from "@/components/actions";
import { ArchitectureView } from "@/components/architecture-view";
import { fmtPct, fmtDate, fmtDuration, shortSha } from "@/lib/util";
import { all, one } from "@/lib/db";
import type { RunSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = projectById(id);
  if (!p) notFound();

  const latest = p.runs[0];
  const latestRun = latest ? one<Record<string, any>>(
    "SELECT id, summary, cost, status FROM runs WHERE id = ?", [latest.id]) : null;
  const snapshot = latest
    ? one<{ id: string }>("SELECT id FROM arch_snapshots WHERE run_id = ?", [latest.id])
    : null;
  const diagrams: Array<Record<string, any>> = snapshot
    ? all("SELECT * FROM diagrams WHERE snapshot_id = ? ORDER BY in_email DESC, kind", [snapshot.id])
    : [];
  const coverage: Array<Record<string, any>> = snapshot
    ? all("SELECT node_id, kind, tests_total, passed, failed, flaky, state FROM node_coverage WHERE run_id = ? ORDER BY tests_total DESC LIMIT 60", [latest?.id ?? ""])
    : [];

  const summary = latestRun ? (JSON.parse(String(latestRun.summary ?? "null")) as RunSummary | null) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kpi-label">Project</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">{p.name}</h1>
          <p className="mono mt-1 text-xs text-slate-500">{p.repo_url} · {p.default_branch} · scaffold {p.scaffold_root}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip text-slate-300">{p.mode.replace("_", "-")}</span>
          <RunButton projectId={id} />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="kpi-label">Runs</p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">{p.runs.length}</p>
        </Card>
        <Card className="p-4">
          <p className="kpi-label">Pass rate terakhir</p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">{summary ? fmtPct(summary.pass_rate, 1) : "—"}</p>
          {summary?.delta_pass_rate !== null && summary?.delta_pass_rate !== undefined ? (
            <p className={`text-xs ${summary.delta_pass_rate >= 0 ? "text-go" : "text-stop"}`}>
              {summary.delta_pass_rate >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(summary.delta_pass_rate), 1)} dari run sebelumnya
            </p>
          ) : null}
        </Card>
        <Card className="p-4">
          <p className="kpi-label">Environment</p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">{p.environments.length}</p>
          <p className="mono truncate text-xs text-slate-500">{p.environments[0]?.base_url ?? "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="kpi-label">Penerima laporan</p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">{p.recipients.length}</p>
          <p className="truncate text-xs text-slate-500">{(p.recipients as Array<{ email: string }>).map((r) => r.email).join(", ") || "—"}</p>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title="Histori run" sub="20 run terakhir" />
          {p.runs.length ? (
            <div className="overflow-x-auto px-2 pb-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="kpi-label border-b border-slate-700/50">
                    <th className="px-3 py-2">Run</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Pass rate</th>
                    <th className="px-3 py-2">Durasi</th>
                    <th className="px-3 py-2">Waktu</th>
                  </tr>
                </thead>
                <tbody>
                  {p.runs.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/60 hover:bg-white/[0.03]">
                      <td className="px-3 py-2">
                        <Link href={`/runs/${r.id}`} className="text-slate-100 hover:text-dispatch">#{r.id.slice(-6)}</Link>
                        <div className="mono text-[11px] text-slate-500">{shortSha(r.commit_sha)} · {r.trigger}</div>
                      </td>
                      <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                      <td className="mono px-3 py-2 text-xs">{r.summary ? `${fmtPct(r.summary.pass_rate)} · ${r.summary.passed}/${r.summary.total}` : "—"}</td>
                      <td className="mono px-3 py-2 text-xs text-slate-400">{fmtDuration(r.summary?.duration_ms ?? 0)}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(r.created_at, "id-ID")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Belum ada run" hint="Tekan Jalankan Run untuk memulai pipeline penuh." />}
        </Card>

        <Card>
          <CardHead title="Environment & penerima" sub="Konfigurasi target eksekusi" />
          <div className="space-y-3 px-5 pb-5">
            {p.environments.map((e: any) => (
              <div key={e.id} className="rounded-lg border border-slate-700/60 bg-night-900/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">{e.name}</span>
                  <span className="chip text-slate-400">{e.auth_strategy}</span>
                </div>
                <p className="mono mt-1 truncate text-[11px] text-slate-500">{e.base_url}</p>
              </div>
            ))}
            <div className="space-y-1.5">
              <p className="kpi-label">Report dikirim ke</p>
              {p.recipients.map((r: any) => (
                <p key={r.id} className="mono text-xs text-slate-400">✉ {r.email} <span className="text-slate-600">({r.locale})</span></p>
              ))}
            </div>
            <div className="hairline" />
            <div>
              <p className="kpi-label">Deteksi otomatis</p>
              <p className="mt-1 text-xs text-slate-400">
                Analisis dijalankan pada tahap CLONING/ANALYZING. Buka tab Arsitektur pada run terakhir untuk melihat
                stack, route, endpoint, dan diagram.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {diagrams.length ? (
        <Card>
          <CardHead
            title="Arsitektur & cakupan test"
            sub={`Snapshot terakhir · ${latest?.id.slice(-6) ?? ""}`}
            right={latest ? <Link href={`/architecture?run=${latest.id}`} className="btn btn-ghost text-xs">Buka viewer</Link> : null}
          />
          <ArchitectureView diagrams={diagrams as never} coverage={coverage as never} />
        </Card>
      ) : null}
    </div>
  );
}