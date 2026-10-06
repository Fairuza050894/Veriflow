import { Card, CardHead } from "@/components/ui";
import { all } from "@/lib/db";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/util";
import { readPrompts } from "@/lib/prompts";
import { BarList } from "@/components/charts";

export const dynamic = "force-dynamic";

/** Prompt Registry: versi, isi, dan pemakaian (FR-DSH-07). */
export default async function PromptsPage() {
  const prompts = await readPrompts();
  const usage = all<{ prompt_name: string; n: number; tokens: number; cost: number }>(
    `SELECT prompt_name, COUNT(*) n, SUM(input_tokens + output_tokens) tokens, SUM(cost_usd) cost
     FROM ai_calls GROUP BY prompt_name ORDER BY n DESC`);
  const calls = all<Record<string, any>>(
    "SELECT prompt_name, prompt_version, model, input_tokens, output_tokens, cost_usd, latency_ms FROM ai_calls ORDER BY rowid DESC LIMIT 20");

  return (
    <div className="space-y-4">
      <div>
        <p className="kpi-label">Prompt Registry</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">Prompt pack berversi</h1>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Semua prompt hidup di <code className="mono text-slate-400">prompts/</code> dan di-hash saat dipakai.
          Setiap panggilan LLM tercatat: versi prompt, model, token, biaya, latensi — sehingga test AI bisa ditelusuri
          kembali ke versi prompt yang menghasilkannya (G6, FR-AI-07).
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <p className="kpi-label">Pemakaian per role</p>
          <BarList items={usage.map((u) => ({ label: u.prompt_name, value: u.n }))} tone="#22d3ee" />
        </Card>
        <Card className="p-4">
          <p className="kpi-label">Total token / biaya</p>
          <p className="mt-1 text-2xl font-semibold text-slate-50">{fmtMoney(usage.reduce((a, u) => a + u.cost, 0))}</p>
          <p className="mono text-[11px] text-slate-500">{fmtNum(usage.reduce((a, u) => a + u.tokens, 0))} token · {usage.reduce((a, u) => a + u.n, 0)} panggilan</p>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {prompts.map((p) => (
          <Card key={p.name}>
            <CardHead
              title={<span className="mono">{p.name}</span>}
              sub={`${p.version} · ${p.hash} · ${p.stage}`}
              right={<span className="chip text-slate-400">prompt</span>}
            />
            <pre className="mx-5 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-night-950/70 p-3 text-[11px] leading-relaxed text-slate-400">
              {p.body}
            </pre>
          </Card>
        ))}
      </div>

      <Card>
        <CardHead title="Log panggilan LLM" sub="20 terakhir" />
        <div className="overflow-x-auto px-2 pb-4">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="kpi-label border-b border-slate-700/50">
                <th className="px-3 py-2">Prompt</th><th className="px-3 py-2">Versi</th><th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th><th className="px-3 py-2">Biaya</th><th className="px-3 py-2">Latensi</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c, i) => (
                <tr key={i} className="border-b border-slate-800/60">
                  <td className="mono px-3 py-1.5 text-slate-300">{String(c.prompt_name)}</td>
                  <td className="mono px-3 py-1.5 text-slate-500">{String(c.prompt_version)}</td>
                  <td className="mono px-3 py-1.5 text-slate-500">{String(c.model)}</td>
                  <td className="mono px-3 py-1.5">{fmtNum(Number(c.input_tokens))}</td>
                  <td className="mono px-3 py-1.5">{fmtNum(Number(c.output_tokens))}</td>
                  <td className="mono px-3 py-1.5 text-slate-400">{fmtMoney(Number(c.cost_usd))}</td>
                  <td className="mono px-3 py-1.5 text-slate-500">{fmtNum(Number(c.latency_ms))}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHead title="Catatan evaluasi" sub="FR-AI-11 — golden repo evaluation" />
        <p className="px-5 pb-5 text-xs text-slate-400">
          Harness evaluasi (golden repo: NestJS+Prisma, Next+Postgres, Django, Laravel, Spring) dijalankan di CI.
          Skor = % test lulus stability × cakupan endpoint/route × bebas pelanggaran aturan.
          <span className="ml-1 text-slate-500">Status pada MVP: belum dijalankan otomatis — lihat docs/ROADMAP.md §V1.</span>
        </p>
      </Card>
    </div>
  );
}