import { Card, CardHead } from "@/components/ui";
import { all, one, getDb } from "@/lib/db";
import { env as envList } from "@/lib/env";
import { fmtNum, fmtDate } from "@/lib/util";
import { readPrompts } from "@/lib/prompts";

export const dynamic = "force-dynamic";

/** Settings: konfigurasi adapter, org, retensi, dan status komponen (FR-DSH-09). */
export default async function SettingsPage() {
  const org = await one<Record<string, any>>("SELECT * FROM organizations LIMIT 1");
  const projects = await all<Record<string, any>>("SELECT id, name, mode, repo_url FROM projects");
  const counts = {
    runs: (await one<{ n: number }>("SELECT COUNT(*) n FROM runs"))?.n ?? 0,
    logs: (await one<{ n: number }>("SELECT COUNT(*) n FROM run_logs"))?.n ?? 0,
    tests: (await one<{ n: number }>("SELECT COUNT(*) n FROM test_results"))?.n ?? 0,
    emails: (await one<{ n: number }>("SELECT COUNT(*) n FROM email_messages"))?.n ?? 0,
    diagrams: (await one<{ n: number }>("SELECT COUNT(*) n FROM diagrams"))?.n ?? 0,
  };
  const prompts = await readPrompts();
  getDb();

  return (
    <div className="space-y-4">
      <div>
        <p className="kpi-label">Settings</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">Konfigurasi platform</h1>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="Adapter aktif" sub="Semua punya fallback mock — platform jalan tanpa kredensial" />
          <ul className="space-y-2 px-5 pb-5 text-xs">
            {envList().map((e) => (
              <li key={e.key} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/60 bg-night-900/60 px-3 py-2">
                <span className="mono text-slate-300">{e.key}</span>
                <span className="flex items-center gap-2">
                  <span className="text-slate-400">{e.value || "(unset)"}</span>
                  <span className={`chip ${e.mock ? "text-slate-400" : "text-go"}`}>{e.mock ? "mock" : "live"}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHead title="Organisasi & tenant" sub="Multi-tenant: Organization → Projects → Runs" />
          <div className="space-y-2 px-5 pb-5 text-xs">
            <div className="rounded-lg border border-slate-700/60 bg-night-900/60 p-3">
              <p className="text-sm font-semibold text-slate-100">{org?.name ?? "—"}</p>
              <p className="mono mt-0.5 text-[11px] text-slate-500">plan: {org?.plan ?? "—"} · dibuat {fmtDate(String(org?.created_at ?? ""), "id-ID")}</p>
            </div>
            {projects.map((p) => (
              <div key={String(p.id)} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/60 bg-night-900/60 px-3 py-2">
                <span className="truncate text-slate-300">{String(p.name)}</span>
                <span className="chip text-slate-400">{String(p.mode).replace("_", "-")}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <p className="kpi-label">Data tersimpan</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            <li>Runs: {fmtNum(counts.runs)}</li>
            <li>Log baris: {fmtNum(counts.logs)}</li>
            <li>Hasil test: {fmtNum(counts.tests)}</li>
            <li>Email: {fmtNum(counts.emails)}</li>
            <li>Diagram: {fmtNum(counts.diagrams)}</li>
          </ul>
        </Card>
        <Card className="p-4">
          <p className="kpi-label">Prompt pack</p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">{prompts.length}</p>
          <p className="text-[11px] text-slate-500">file di <code className="mono">prompts/</code>, di-hash saat dipakai</p>
        </Card>
        <Card className="p-4">
          <p className="kpi-label">Batas & kebijakan</p>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
            <li>Signed link report: {14} hari</li>
            <li>Max test per run: 60</li>
            <li>Self-heal: maks 3 iterasi</li>
            <li>Concurrency: 1 run per project</li>
            <li>Egress runner: deny by default</li>
          </ul>
        </Card>
      </div>

      <Card>
        <CardHead title="Integrasi" sub="Sudah terpasang di kode, aktif lewat environment variable" />
        <div className="grid gap-2 px-5 pb-5 text-xs md:grid-cols-2">
          {[
            ["GitHub App / PAT", "GITHUB_PAT — clone repo privat + buka PR"],
            ["Webhook push/PR", "GITHUB_WEBHOOK_SECRET — HMAC SHA-256 + dedupe delivery-id"],
            ["LLM (Anthropic)", "ANTHROPIC_API_KEY + LLM_MODEL_GENERATOR"],
            ["Email (Resend / SMTP)", "RESEND_API_KEY atau SMTP_URL"],
            ["Runner eksternal", "RUNNER_URL + RUNNER_CALLBACK_SECRET"],
            ["Diagram PNG/PDF", "mmdc / d2 / graphviz di runner diagram"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-700/60 bg-night-900/60 px-3 py-2">
              <p className="text-slate-200">{k}</p>
              <p className="mono mt-0.5 text-[11px] text-slate-500">{v}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}