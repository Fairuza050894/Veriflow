import Link from "next/link";
import { Card, CardHead, Kpi, StatusChip, EmptyState } from "@/components/ui";
import { PassTrend, BarList, Donut, Sparkline } from "@/components/charts";
import { overview, allRunRows } from "@/lib/queries";
import { getLang } from "@/lib/lang-server";
import { t } from "@/lib/i18n";
import { fmtPct, fmtDuration, fmtMoney, fmtNum, fmtDate, shortSha } from "@/lib/util";
import { ConnectRepoButton, CancelButton } from "@/components/actions";
import { all } from "@/lib/db";
import { DashboardControls } from "@/components/dashboard-controls";
import type { Overview } from "@/lib/queries";

export const dynamic = "force-dynamic";

const CAT_COLORS: Record<string, string> = {
  product_bug: "#ef4444", test_bug: "#f59e0b", env_issue: "#3b82f6",
  data_issue: "#a855f7", infra: "#64748b", flaky: "#eab308",
};

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const lang = await getLang();
  const id = lang === "id";
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const status = ["FAILED", "WAITING_APPROVAL", "COMPLETED", "COMPLETED_WITH_WARNINGS", "CANCELLED", "TIMED_OUT"].includes(params.status ?? "") ? params.status! : "";
  const o: Overview = await overview();
  const projects = await all<{ id: string; name: string }>("SELECT id, name FROM projects ORDER BY name");
  const recentRuns = query || status ? await allRunRows(
    "WHERE (LOWER(p.name) LIKE LOWER(?) OR LOWER(r.branch) LIKE LOWER(?)) AND (? = '' OR r.status = ?) ORDER BY r.created_at DESC LIMIT 50",
    [`%${query}%`, `%${query}%`, status, status]) : o.recentRuns;
  const activeRuns = await allRunRows(
    "WHERE r.status NOT IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','COMPLETED_WITH_WARNINGS') ORDER BY r.created_at DESC LIMIT 4");

  return (
    <div className="space-y-4">
      {/* Hero */}
      <section className="panel relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-dispatch/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-32 h-56 w-56 rounded-full bg-amber-glow/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kpi-label">{t(lang, "brand.tagline")}</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">
              {id ? "Pusat kendali kualitas" : "Quality control dashboard"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              {id ? "Pantau hasil pengujian, tinjau run yang perlu tindakan, jalankan project berikutnya." : "Monitor test results, review runs needing attention, and start your next project run."}
            </p>
          </div>
          <div className="flex gap-2">
            <ConnectRepoButton label={t(lang, "action.connect")} />
          </div>
        </div>
        <div className="relative mt-4"><DashboardControls projects={projects} lang={lang} /></div>
        <p className="relative mt-3 text-xs text-amber-300">{id ? "SIMULASI — hasil runner, biaya AI, dan PR masih menggunakan data mock." : "SIMULATION — runner results, AI costs, and PRs currently use mock data."}</p>
        <div className="hairline my-5" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Antrean aktif" value={fmtNum(o.queueDepth)} hint="run menunggu atau berjalan" />
          <Stat label={id ? "Run tahap eksekusi" : "Runs executing"} value={fmtNum(o.runnerActive)} hint={id ? "jumlah run, bukan shard" : "run count, not shards"} />
          <Stat label="Run 24 jam" value={fmtNum(o.runs24h)} hint={`${fmtNum(o.projects)} project terhubung`} />
          <Stat label="Email 30 hari" value={fmtNum(o.emailsSent)} hint="laporan terkirim" />
        </div>
      </section>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t(lang, "kpi.projects")} value={fmtNum(o.projects)} tone="cyan" />
        <Kpi label={t(lang, "kpi.runs24h")} value={fmtNum(o.runs24h)} tone="cyan" />
        <Kpi
          label={t(lang, "kpi.passrate")}
           value={o.passTrend.length ? fmtPct(o.passRate7d, 1) : "—"}
          tone={o.passRate7d >= 0.95 ? "go" : o.passRate7d >= 0.9 ? "hold" : "stop"}
          delta={<Sparkline data={o.passTrend.map((p) => p.rate)} height={26} />}
        />
        <Kpi label={t(lang, "kpi.flaky")} value={fmtNum(o.flakyActive)} tone="hold" />
        <Kpi label={t(lang, "kpi.cost")} value={fmtMoney(o.costMonth)} tone="amber" delta="LLM 30 hari" />
        <Kpi label={t(lang, "kpi.duration")} value={fmtDuration(o.durationP95)} tone="amber" />
      </div>

      {activeRuns.length ? (
        <Card>
          <CardHead title="Sedang berjalan" sub="Pipeline aktif — klik untuk melihat progres langsung" />
          <div className="grid gap-2 px-5 pb-5">
            {activeRuns.map((r) => (
               <div key={r.id} className="relative flex flex-wrap items-center justify-between gap-4 rounded-lg border border-dispatch/20 bg-dispatch/[0.04] px-4 py-3">
                 <Link href={`/runs/${r.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">{r.project_name}</span>
                    <StatusChip status={r.status} />
                  </div>
                  <p className="mono mt-0.5 truncate text-xs text-slate-500">
                    {r.branch}@{shortSha(r.commit_sha)} · {r.env_name ?? "default"} · {fmtDate(r.created_at, lang === "id" ? "id-ID" : "en-US")}
                   </p>
                 </Link>
                <div className="shrink-0">
                  <CancelButton runId={r.id} />
                </div>
               </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title={t(lang, "chart.passrate")} sub="Rata-rata pass rate per hari, 14 hari terakhir" />
          <div className="px-3 pb-4"><PassTrend points={o.passTrend} /></div>
        </Card>
        <Card>
          <CardHead title={t(lang, "chart.categories")} sub="Klasifikasi kegagalan otomatis" />
          <Donut
            slices={o.categories.map((c) => ({ label: c.key, value: c.n, color: CAT_COLORS[c.key] ?? "#64748b" }))}
            center={<text x="50" y="55" textAnchor="middle" fill="#e2e8f0" fontSize="14" fontWeight="600">{o.categories.reduce((a, c) => a + c.n, 0)}</text>}
          />
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHead title={t(lang, "chart.slowest")} sub="Rata-rata durasi per test" />
          <BarList items={o.slowest.map((s) => ({ label: s.title, value: Math.round(s.ms) }))} tone="#f59e0b" format={fmtDuration} />
        </Card>
        <Card>
          <CardHead title={t(lang, "chart.flaky")} sub="Skor flaky (≥ 0.15 curiga, ≥ 0.30 quarantine)" />
          <BarList items={o.flakyTop.map((s) => ({ label: s.title, value: Number(s.score.toFixed(2)) }))} tone="#eab308" format={(v) => v.toFixed(2)} />
        </Card>
        <Card>
           <CardHead title={id ? "Durasi run" : "Run duration"} sub={id ? "Persentil dari maksimal 50 run terbaru, 14 hari" : "Percentiles from up to 50 recent runs, 14 days"} />
          <div className="space-y-3 px-5 pb-5">
             {o.runDurations.map((item) => ({ k: item.label.toUpperCase(), v: item.p50 || item.p95 })).map((s) => (
              <div key={s.k}>
                 <div className="flex justify-between text-xs"><span className="text-slate-300">{s.k}</span><span className="mono text-slate-300">{s.v ? fmtDuration(s.v) : "—"}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-night-700">
                   <div className="h-full rounded-full bg-dispatch" style={{ width: `${Math.min(100, s.v / (o.durationP95 || 1) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
           <CardHead title={t(lang, "table.recent")} sub={id ? "8 run terbaru; hingga 50 hasil saat filter aktif" : "8 recent runs; up to 50 results when filtered"} />
           <form className="flex flex-wrap items-end gap-2 px-5 pb-4" action="/">
             <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-slate-300">{id ? "Cari project / branch" : "Search project / branch"}
               <input name="q" defaultValue={query} maxLength={100} className="rounded-lg border border-slate-600 bg-night-900 px-3 py-2 text-sm" />
             </label>
             <label className="flex flex-col gap-1 text-xs text-slate-300">Status
               <select name="status" defaultValue={status} className="rounded-lg border border-slate-600 bg-night-900 px-3 py-2 text-sm">
                 <option value="">{id ? "Semua status" : "All statuses"}</option>
                 {["FAILED", "WAITING_APPROVAL", "COMPLETED", "COMPLETED_WITH_WARNINGS", "CANCELLED", "TIMED_OUT"].map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
               </select>
             </label>
             <button className="btn btn-ghost" type="submit">Filter</button>
             {(query || status) && <Link href="/" className="btn btn-ghost">Reset</Link>}
           </form>
           <RunTable runs={recentRuns} lang={lang} />
        </Card>
        <Card>
          <CardHead title={t(lang, "table.attention")} sub="Gagal atau menunggu persetujuan" />
          {o.attentionRuns.length ? (
            <div className="space-y-2 px-5 pb-5">
              {o.attentionRuns.map((r) => (
                <Link key={r.id} href={`/runs/${r.id}`} className="block rounded-lg border border-stop/25 bg-stop/[0.05] px-3 py-2.5 transition hover:border-stop/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-200">{r.project_name}</span>
                    <StatusChip status={r.status} pulse={false} />
                  </div>
                  <p className="mono mt-1 text-[11px] text-slate-500">#{r.id.slice(-6)} · {fmtDate(r.created_at, "id-ID")}</p>
                </Link>
              ))}
            </div>
          ) : (
             <EmptyState title={id ? "Tidak ada run yang perlu tindakan" : "No runs need attention"} hint={id ? "Tidak ada run gagal, timeout, atau menunggu persetujuan." : "No failed, timed-out, or approval-pending runs."} />
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="kpi-label">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-100">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function RunTable({ runs, lang }: { runs: Awaited<ReturnType<typeof allRunRows>>; lang: "id" | "en" }) {
  if (!runs.length) return <EmptyState title={t(lang, "empty.noRuns")} />;
  return (
    <div className="overflow-x-auto px-2 pb-4">
       <table className="w-full text-left text-sm">
         <caption className="sr-only">{t(lang, "table.recent")}</caption>
        <thead>
          <tr className="kpi-label border-b border-slate-700/50">
            <th className="px-3 py-2">Project</th>
            <th className="px-3 py-2">{t(lang, "label.status")}</th>
            <th className="px-3 py-2">Pass</th>
            <th className="px-3 py-2">{t(lang, "label.duration")}</th>
            <th className="px-3 py-2">Biaya</th>
            <th className="px-3 py-2">Waktu</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-b border-slate-800/60 transition hover:bg-white/[0.03]">
              <td className="px-3 py-2.5">
                <Link href={`/runs/${r.id}`} className="text-slate-100 hover:text-dispatch">{r.project_name}</Link>
                <div className="mono text-[11px] text-slate-500">{r.branch}@{shortSha(r.commit_sha)} · {r.trigger}</div>
              </td>
              <td className="px-3 py-2.5"><StatusChip status={r.status} /></td>
              <td className="px-3 py-2.5">
                {r.summary ? (
                  <span className="mono text-xs">
                    <span className={r.summary.pass_rate >= 0.95 ? "text-go" : r.summary.pass_rate >= 0.9 ? "text-hold" : "text-stop"}>
                      {fmtPct(r.summary.pass_rate)}
                    </span>
                    <span className="text-slate-600"> · {r.summary.passed}/{r.summary.total}</span>
                     {r.summary.failed ? <span className="ml-1.5 text-stop">{r.summary.failed} {lang === "id" ? "gagal" : "failed"}</span> : null}
                  </span>
                ) : <span className="text-xs text-slate-600">—</span>}
              </td>
               <td className="mono px-3 py-2.5 text-xs text-slate-400">{r.summary ? fmtDuration(r.summary.duration_ms) : "—"}</td>
               <td className="mono px-3 py-2.5 text-xs text-slate-400">{r.cost?.cost_usd != null ? fmtMoney(r.cost.cost_usd) : "—"}</td>
              <td className="px-3 py-2.5 text-xs text-slate-500">{fmtDate(r.created_at, lang === "id" ? "id-ID" : "en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
