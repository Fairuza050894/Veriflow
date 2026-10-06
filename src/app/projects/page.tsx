import Link from "next/link";
import { Card, CardHead, StatusChip, EmptyState } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { allRunRows } from "@/lib/queries";
import { all } from "@/lib/db";
import { RunButton, ConnectRepoButton } from "@/components/actions";
import { fmtPct, fmtDate, fmtDuration, shortSha } from "@/lib/util";
import { getLang } from "@/lib/lang-server";
import { t } from "@/lib/i18n";
import type { RecentRun } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const lang = await getLang();
  const projects = await all<Record<string, any>>("SELECT * FROM projects ORDER BY created_at DESC");
  const runs: RecentRun[] = await allRunRows();

  // Pre-fetch envs and recipients for all projects
  const envsMap = new Map<string, any[]>();
  const recipsMap = new Map<string, any[]>();
  for (const p of projects) {
    const envs = await all<Record<string, any>>("SELECT * FROM environments WHERE project_id = ? ORDER BY id DESC", [p.id]);
    const recips = await all<{ email: string }>("SELECT email FROM recipients WHERE project_id = ? ORDER BY verified_at DESC", [p.id]);
    envsMap.set(p.id, envs);
    recipsMap.set(p.id, recips);
  }

  if (!projects.length) {
    return (
      <Card>
        <EmptyState
          title="Belum ada project"
          hint="Hubungkan repository untuk mulai. Veriflow mendeteksi stack, menyusun test plan, dan menjalankan pengujian otomatis."
          action={<ConnectRepoButton />}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kpi-label">Connected repositories</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">Project</h1>
        </div>
        <ConnectRepoButton />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((p) => {
          const pr = runs.filter((r) => r.project_id === p.id);
          const rates = pr.map((r) => r.summary?.pass_rate ?? 0).filter((n) => n > 0);
          const latest = pr[0];
          const envs = envsMap.get(p.id) ?? [];
          const recips = recipsMap.get(p.id) ?? [];
          return (
            <Card key={p.id} hover className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/projects/${p.id}`} className="text-base font-semibold text-slate-50 hover:text-dispatch">
                    {p.name}
                  </Link>
                  <p className="mono mt-0.5 truncate text-xs text-slate-500">{p.repo_url}</p>
                </div>
                <span className="chip text-slate-300">{p.mode.replace("_", "-")}</span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <div><p className="kpi-label">Runs</p><p className="mt-0.5 text-slate-200">{pr.length}</p></div>
                <div><p className="kpi-label">Pass rate</p><p className="mt-0.5 text-slate-200">{rates.length ? fmtPct(rates[0], 1) : "—"}</p></div>
                <div><p className="kpi-label">Env</p><p className="mt-0.5 text-slate-200">{envs.length}</p></div>
              </div>

              {rates.length > 1 ? <div className="mt-3"><Sparkline data={rates} height={34} tone="#f59e0b" /></div> : null}

              <div className="mt-4 space-y-1.5 border-t border-slate-800/70 pt-3 text-xs text-slate-500">
                <p className="truncate">Branch <span className="mono text-slate-300">{p.default_branch}</span></p>
                <p className="truncate">Penerima <span className="mono text-slate-300">{recips.map((r) => r.email).join(", ") || "—"}</span></p>
                {latest ? (
                  <p className="flex items-center gap-2">
                    <StatusChip status={latest.status} />
                    <span className="mono">{latest.branch}@{shortSha(latest.commit_sha)}</span>
                    <span className="ml-auto">{fmtDate(latest.created_at, "id-ID")}</span>
                  </p>
                ) : null}
              </div>

              <div className="mt-4 flex gap-2">
                <RunButton projectId={String(p.id)} label="▶ Jalankan" />
                <Link href={`/projects/${p.id}`} className="btn btn-ghost">Detail</Link>
                {pr[0] ? <Link href={`/runs/${pr[0].id}`} className="btn btn-ghost">Run terakhir ({fmtDuration(pr[0].summary?.duration_ms ?? 0)})</Link> : null}
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHead title="Histori run" sub="10 run terakhir lintas project" />
        <div className="overflow-x-auto px-2 pb-4">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="kpi-label border-b border-slate-700/50">
                <th className="px-3 py-2">Project</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Pass</th>
                <th className="px-3 py-2">Durasi</th>
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2">{t(lang, "label.status")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 10).map((r) => (
                <tr key={r.id} className="border-b border-slate-800/60 hover:bg-white/[0.03]">
                  <td className="px-3 py-2">
                    <Link href={`/runs/${r.id}`} className="text-slate-100 hover:text-dispatch">{r.project_name}</Link>
                    <div className="mono text-[11px] text-slate-500">{r.env_name} · #{r.id.slice(-6)}</div>
                  </td>
                  <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                  <td className="mono px-3 py-2 text-xs">{r.summary ? `${fmtPct(r.summary.pass_rate)} · ${r.summary.passed}/${r.summary.total}` : "—"}</td>
                  <td className="mono px-3 py-2 text-xs text-slate-400">{fmtDuration(r.summary?.duration_ms ?? 0)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.trigger}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(r.created_at, "id-ID")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}