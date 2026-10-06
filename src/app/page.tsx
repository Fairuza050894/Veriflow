import Link from "next/link";
import { Card, CardHead, Kpi, StatusChip, EmptyState, CategoryChip } from "@/components/ui";
import { PassTrend, BarList, Donut, Sparkline } from "@/components/charts";
import { overview, allRunRows } from "@/lib/queries";
import { getLang } from "@/lib/lang-server";
import { t } from "@/lib/i18n";
import { fmtPct, fmtDuration, fmtMoney, fmtNum, fmtDate, shortSha } from "@/lib/util";
import { ConnectRepoButton, RunButton, CancelButton } from "@/components/actions";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

const CAT_COLORS: Record<string, string> = {
  product_bug: "#ef4444", test_bug: "#f59e0b", env_issue: "#3b82f6",
  data_issue: "#a855f7", infra: "#64748b", flaky: "#eab308",
};

export default async function OverviewPage() {
  const lang = await getLang();
  const o = overview();
  const firstProject = one<{ id: string }>("SELECT id FROM projects ORDER BY created_at LIMIT 1");
  const activeRuns = allRunRows(
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
              Kendali kualitas rantai pasok Anda, <span className="text-dispatch">otomatis</span>.
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Tempel URL repo → Veriflow mendeteksi stack, merancang test plan, menghasilkan test UI + API,
              menjalankannya di sandbox, lalu mengirim ringkasan + diagram arsitektur ke stakeholder lewat email.
            </p>
          </div>
          <div className="flex gap-2">
            {firstProject ? <RunButton projectId={firstProject.id} label={t(lang, "action.run")} /> : null}
            <ConnectRepoButton label={t(lang, "action.connect")} />
          </div>
        </div>
        <div className="hairline my-5" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Antrean aktif" value={fmtNum(o.queueDepth)} hint="run menunggu atau berjalan" />
          <Stat label="Runner aktif" value={fmtNum(o.runnerActive)} hint="shard Playwright berjalan" />
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
          value={fmtPct(o.passRate7d, 1)}
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
              <Link key={r.id} href={`/runs/${r.id}`} className="sweep relative flex items-center justify-between gap-4 overflow-hidden rounded-lg border border-dispatch/20 bg-dispatch/[0.04] px-4 py-3 transition hover:border-dispatch/50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">{r.project_name}</span>
                    <StatusChip status={r.status} />
                  </div>
                  <p className="mono mt-0.5 truncate text-xs text-slate-500">
                    {r.branch}@{shortSha(r.commit_sha)} · {r.env_name ?? "default"} · {fmtDate(r.created_at, lang === "id" ? "id-ID" : "en-US")}
                  </p>
                </div>
                <div className="shrink-0">
                  <CancelButton runId={r.id} />
                </div>
              </Link>
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
          <CardHead title="Pipeline stage" sub="Durasi p50 vs p95 seluruh run" />
          <div className="space-y-3 px-5 pb-5">
            {[
              { k: "Clone → Analyze", v: 42 },
              { k: "Generate + heal", v: 96 },
              { k: "Execute shards", v: 240 },
              { k: "Report + email", v: 38 },
            ].map((s) => (
              <div key={s.k}>
                <div className="flex justify-between text-xs"><span className="text-slate-400">{s.k}</span><span className="mono text-slate-500">{fmtDuration(s.v * 1000)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-night-700">
                  <div className="h-full rounded-full bg-gradient-to-r from-dispatch to-amber-glow" style={{ width: `${Math.min(100, s.v / 2.4)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Tables */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title={t(lang, "table.recent")} sub="Delapan run terakhir lintas project" />
          <RunTable runs={o.recentRuns} lang={lang} />
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
            <EmptyState title="Tidak ada run bermasalah" hint="Semua pipeline selesai bersih dalam 24 jam terakhir." />
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

function RunTable({ runs, lang }: { runs: ReturnType<typeof allRunRows>; lang: "id" | "en" }) {
  if (!runs.length) return <EmptyState title={t(lang, "empty.noRuns")} />;
  return (
    <div className="overflow-x-auto px-2 pb-4">
      <table className="w-full text-left text-sm">
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
                    {r.summary.failed ? <span className="ml-1.5"><CategoryChip category="product_bug" /></span> : null}
                  </span>
                ) : <span className="text-xs text-slate-600">—</span>}
              </td>
              <td className="mono px-3 py-2.5 text-xs text-slate-400">{fmtDuration(r.summary?.duration_ms ?? 0)}</td>
              <td className="mono px-3 py-2.5 text-xs text-slate-400">{r.cost?.cost_usd ? fmtMoney(r.cost.cost_usd) : "—"}</td>
              <td className="px-3 py-2.5 text-xs text-slate-500">{fmtDate(r.created_at, lang === "id" ? "id-ID" : "en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}