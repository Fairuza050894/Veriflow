import Link from "next/link";
import { Card, CardHead, StatusChip, CategoryChip, EmptyState } from "@/components/ui";
import { all } from "@/lib/db";
import { fmtDuration, fmtDate, fmtNum } from "@/lib/util";

export const dynamic = "force-dynamic";

/** Test Explorer global: agregasi seluruh run + filter flaky/quarantine (FR-DSH-04). */
export default async function TestsPage({ searchParams }: { searchParams: Promise<{ status?: string; run?: string }> }) {
  const sp = await searchParams;
  const where: string[] = ["1=1"];
  const args: string[] = [];
  if (sp.run) { where.push("run_id = ?"); args.push(sp.run); }
  if (sp.status) { where.push("status = ?"); args.push(sp.status); }

  const rows = all<Record<string, any>>(
    `SELECT tr.*, p.name project_name FROM test_results tr JOIN projects p ON p.id = tr.project_id
     WHERE ${where.join(" AND ")} ORDER BY tr.run_id, tr.duration_ms DESC LIMIT 300`, args);

  const counts = all<{ status: string; n: number }>(
    "SELECT status, COUNT(*) n FROM test_results GROUP BY status");
  const quarantined = all<{ n: string }>("SELECT COUNT(*) n FROM test_results WHERE quarantined = 1")[0]?.n ?? "0";

  const parsed = rows.map<Record<string, any>>((r) => ({ ...r, tags: JSON.parse(String(r.tags ?? "[]")) as string[] }));

  return (
    <div className="space-y-4">
      <div>
        <p className="kpi-label">Test Explorer</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">Semua test lintas project</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {counts.map((c) => (
          <Card key={c.status} className="p-4">
            <p className="kpi-label">{c.status}</p>
            <p className="mt-1 text-xl font-semibold text-slate-50">{fmtNum(c.n)}</p>
          </Card>
        ))}
        <Card className="p-4">
          <p className="kpi-label">Quarantine</p>
          <p className="mt-1 text-xl font-semibold text-hold">{quarantined}</p>
        </Card>
      </div>

      <Card>
        <CardHead title="Filter cepat" sub="Klik status untuk memfilter" />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          {["", "passed", "failed", "flaky", "skipped"].map((s) => (
            <Link
              key={s || "all"}
              href={s ? `/tests?status=${s}` : "/tests"}
              className={`chip ${(sp.status ?? "") === s ? "border-dispatch text-dispatch bg-dispatch/10" : "text-slate-400 hover:text-slate-200"}`}
            >
              {s || "semua"}
            </Link>
          ))}
          {sp.run ? <Link href="/tests" className="chip text-slate-400">✕ clear run filter</Link> : null}
        </div>
      </Card>

      <Card>
        <CardHead title={`Hasil test (${parsed.length})`} sub="Klik nama test untuk membuka run terkait" />
        {parsed.length ? (
          <div className="max-h-[36rem] overflow-auto px-2 pb-4">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-night-900/95 backdrop-blur">
                <tr className="kpi-label border-b border-slate-700/50">
                  <th className="px-3 py-2">Test</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Durasi</th>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2">Tags</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/60 hover:bg-white/[0.03]">
                    <td className="px-3 py-2">
                      <Link href={`/runs/${r.run_id}`} className="text-slate-100 hover:text-dispatch">{r.title}</Link>
                      <div className="mono text-[10px] text-slate-600">{r.file}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-400">{r.project_name}</td>
                    <td className="px-3 py-2"><StatusChip status={r.status} pulse={false} /></td>
                    <td className="mono px-3 py-2 text-slate-400">{fmtDuration(r.duration_ms)}</td>
                    <td className="px-3 py-2"><CategoryChip category={r.error_category} /></td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {r.tags.slice(0, 3).map((tg: string) => <span key={tg} className="chip text-slate-500">{tg}</span>)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Belum ada data test" hint="Jalankan run pada project untuk mengisi Test Explorer." />}
      </Card>

      <Card>
        <CardHead title="Run terbaru dengan hasil" sub="Navigasi cepat" />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          {all<{ id: string; created_at: string }>("SELECT id, created_at FROM runs WHERE summary IS NOT NULL ORDER BY created_at DESC LIMIT 10")
            .map((r) => (
              <Link key={r.id} href={`/tests?run=${r.id}`} className="chip text-slate-400 hover:border-dispatch hover:text-dispatch">
                #{r.id.slice(-6)} · {fmtDate(r.created_at, "id-ID")}
              </Link>
            ))}
        </div>
      </Card>
    </div>
  );
}