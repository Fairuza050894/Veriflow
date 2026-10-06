import Link from "next/link";
import { Card, CardHead, EmptyState } from "@/components/ui";
import { ArchitectureView } from "@/components/architecture-view";
import { all, one } from "@/lib/db";
import { fmtDate } from "@/lib/util";
import { snapshotDiff } from "@/lib/pipeline/actions";

export const dynamic = "force-dynamic";

/** Viewer arsitektur global: pilih snapshot per run, bandingkan dua run (FR-DGM-19). */
export default async function ArchitecturePage({ searchParams }: { searchParams: Promise<{ run?: string; compare?: string }> }) {
  const sp = await searchParams;
  const snaps = all<{ id: string; run_id: string; commit_sha: string; node_count: number; edge_count: number; created_at: string; extractor_status: string }>(
    "SELECT id, run_id, commit_sha, node_count, edge_count, created_at, extractor_status FROM arch_snapshots ORDER BY created_at DESC LIMIT 30");

  if (!snaps.length) {
    return (
      <Card>
        <EmptyState
          title="Belum ada snapshot arsitektur"
          hint="Snapshot dibuat otomatis pada tahap ANALYZING setiap run — repo dibaca oleh extractor deterministik (Prisma, OpenAPI, docker-compose, GitHub Actions, import graph)."
          action={<Link href="/projects" className="btn btn-primary">Jalankan run pertama</Link>}
        />
      </Card>
    );
  }

  const chosen = sp.run ? snaps.find((s) => s.run_id === sp.run) ?? snaps[0] : snaps[0];
  const diagrams = all<Record<string, any>>(
    "SELECT id, kind, title, source, status, audience, in_email, node_count, alt_text FROM diagrams WHERE snapshot_id = ? ORDER BY in_email DESC, kind", [chosen.id]);
  const coverage = all<Record<string, any>>(
    "SELECT node_id, kind, tests_total, passed, failed, flaky, state FROM node_coverage WHERE run_id = ? ORDER BY tests_total DESC LIMIT 80", [chosen.run_id]);
  const findings = all<Record<string, any>>("SELECT code, severity, title, detail, evidence FROM arch_findings WHERE snapshot_id = ?", [chosen.id]);
  const extractors = JSON.parse(chosen.extractor_status) as Array<{ name: string; version: string; status: string; reason?: string }>;
  const diff = sp.compare ? snapshotDiff(sp.compare, chosen.run_id) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kpi-label">Repo intelligence</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">Arsitektur & cakupan test</h1>
          <p className="mono mt-1 text-xs text-slate-500">
            snapshot {chosen.id} · commit {chosen.commit_sha.slice(0, 7)} · {chosen.node_count} node · {chosen.edge_count} edge
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {snaps.slice(0, 8).map((s) => (
            <Link
              key={s.id}
              href={`/architecture?run=${s.run_id}${sp.compare ? `&compare=${sp.compare}` : ""}`}
              className={`chip ${s.run_id === chosen.run_id ? "border-dispatch text-dispatch bg-dispatch/10" : "text-slate-400 hover:text-slate-200"}`}
            >
              #{s.run_id.slice(-6)} · {fmtDate(s.created_at, "id-ID")}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <p className="kpi-label">Extractor (deterministik, tanpa LLM)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {extractors.map((e) => (
              <span key={e.name} className={`chip ${e.status === "ok" ? "text-go" : e.status === "failed" ? "text-stop" : "text-slate-500"}`}
                title={e.reason ?? undefined}>
                <span className="mono">{e.name}</span>@{e.version} · {e.status}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Kegagalan satu extractor tidak membatalkan yang lain dan tidak pernah menggagalkan run (FR-DGM-22).
          </p>
        </Card>
        <Card className="p-4">
          <p className="kpi-label">Bandingkan snapshot</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {snaps.filter((s) => s.run_id !== chosen.run_id).slice(0, 8).map((s) => (
              <Link key={s.id} href={`/architecture?run=${chosen.run_id}&compare=${s.run_id}`} className="chip text-slate-400 hover:text-hold">
                vs #{s.run_id.slice(-6)}
              </Link>
            ))}
          </div>
          {diff ? (
            <div className="mt-3 space-y-1 text-[11px]">
              <p className="text-go">+ {diff.added.length} node baru</p>
              <p className="text-stop">− {diff.removed.length} node hilang</p>
              <p className="text-slate-500">{diff.kept} node tidak berubah</p>
            </div>
          ) : null}
        </Card>
      </div>

      {findings.length ? (
        <Card>
          <CardHead title="Temuan arsitektur" sub="Siklus, endpoint publik tanpa auth, tabel tanpa FK, tahap CI tanpa gate" />
          <div className="grid gap-2 px-5 pb-5 md:grid-cols-2">
            {findings.map((f) => (
              <div key={String(f.code)} className="rounded-lg border border-slate-700/60 bg-night-900/60 p-3">
                <div className="flex items-center gap-2">
                  <span className={`chip ${f.severity === "high" ? "text-stop" : f.severity === "medium" ? "text-hold" : "text-slate-400"}`}>
                    {String(f.severity)}
                  </span>
                  <span className="mono text-[11px] text-slate-400">{String(f.code)}</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-200">{String(f.detail)}</p>
                <p className="mono mt-1 text-[10px] text-slate-600">
                  {(JSON.parse(String(f.evidence ?? "[]")) as Array<{ file: string; line?: number }>).slice(0, 3)
                    .map((e) => `${e.file}${e.line ? `:${e.line}` : ""}`).join(", ") || "tanpa bukti"}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHead title="Diagram" sub="Sumber Mermaid tersimpan & dapat diunduh" />
        <ArchitectureView diagrams={diagrams as never} coverage={coverage as never} />
      </Card>

      <Card>
        <CardHead title="Cakupan per node" sub="Overlay hasil test pada model arsitektur" />
        <div className="max-h-80 overflow-auto px-2 pb-4">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-night-900/95 backdrop-blur">
              <tr className="kpi-label border-b border-slate-700/50">
                <th className="px-3 py-2">Node</th><th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Tests</th><th className="px-3 py-2">Lulus</th>
                <th className="px-3 py-2">Gagal</th><th className="px-3 py-2">Flaky</th><th className="px-3 py-2">State</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((c) => (
                <tr key={String(c.node_id)} className="border-b border-slate-800/60 hover:bg-white/[0.03]">
                  <td className="mono px-3 py-1.5 text-slate-300">{String(c.node_id)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{String(c.kind)}</td>
                  <td className="mono px-3 py-1.5">{String(c.tests_total)}</td>
                  <td className="mono px-3 py-1.5 text-go">{String(c.passed)}</td>
                  <td className="mono px-3 py-1.5 text-stop">{String(c.failed)}</td>
                  <td className="mono px-3 py-1.5 text-hold">{String(c.flaky)}</td>
                  <td className="px-3 py-1.5"><span className="chip text-slate-400">{String(c.state)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}