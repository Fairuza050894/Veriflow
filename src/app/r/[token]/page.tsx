import { notFound } from "next/navigation";
import { publicReportByToken } from "@/lib/pipeline/actions";
import { fmtPct, fmtDuration, fmtDate, shortSha } from "@/lib/util";
import { fmtNum } from "@/lib/util";
import type { RunSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Laporan read-only untuk stakeholder tanpa login (signed link, FR-RPT-07).
 * Halaman ini sengaja TIDAK memakai Shell dashboard — cleaned layout printable.
 */
export default async function PublicReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await publicReportByToken(token);
  if (!data) notFound();

  const s = data.summary as RunSummary | null;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-3xl px-6 py-10 print:px-0">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-slate-900">VERIFLOW</p>
            <h1 className="mt-1 text-2xl font-semibold">Laporan Pengujian Otomatis</h1>
            <p className="mt-1 text-sm text-slate-600">
              {data.project?.name} · {data.env?.name ?? "default"} · commit {shortSha(data.run.commit_sha)} · {data.run.branch}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Run #{data.run.id.slice(-6)}</p>
            <p>{fmtDate(data.run.finished_at ?? data.run.created_at, "id-ID")}</p>
            <p className="mt-1 rounded bg-slate-100 px-2 py-0.5">Tautan bertanda tangan · berlaku 14 hari</p>
          </div>
        </header>

        {/* Ringkasan */}
        <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div className="grid grid-cols-5 gap-3 text-center">
            {[
              ["Total", s?.total ?? 0, "#0f172a"],
              ["Lulus", s?.passed ?? 0, "#1C7A4B"],
              ["Gagal", s?.failed ?? 0, s?.failed ? "#B3261E" : "#94a3b8"],
              ["Flaky", s?.flaky ?? 0, s?.flaky ? "#9A6200" : "#94a3b8"],
              ["Dilewati", s?.skipped ?? 0, "#94a3b8"],
            ].map(([label, value, color]) => (
              <div key={String(label)}>
                <p className="text-2xl font-semibold" style={{ color: String(color) }}>{String(value)}</p>
                <p className="text-[11px] uppercase tracking-wider text-slate-500">{String(label)}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm font-semibold">Pass rate {s ? fmtPct(s.pass_rate, 1) : "—"}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.round((s?.pass_rate ?? 0) * 100)}%` }} />
            </div>
            <span className="text-xs text-slate-500">{s ? fmtDuration(s.duration_ms) : "—"}</span>
          </div>
        </section>

        {/* Ringkasan AI */}
        {s ? (
          <section className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Ringkasan</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{narrative(s)}</p>
          </section>
        ) : null}

        {/* Diagram */}
        {data.diagrams.length ? (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Arsitektur sistem yang diuji</h2>
            <p className="mt-1 text-xs text-slate-500">
              Ringkasan saja pada halaman ini. Diagram vektor lengkap (PDF) dikirim sebagai lampiran; sumber diagram tersimpan di platform.
            </p>
            <ul className="mt-3 space-y-2">
              {data.diagrams.filter((d) => d.status === "ok").map((d) => (
                <li key={String(d.kind)} className="rounded-lg border border-slate-200 px-4 py-3">
                  <p className="text-sm font-semibold">
                    <span className="mono mr-2 text-xs text-slate-400">{String(d.kind)}</span>
                    {String(d.title)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{String(d.alt_text ?? "")}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* Cakupan */}
        {data.coverage.length ? (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Cakupan test</h2>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {data.coverage.slice(0, 12).map((c) => (
                <div key={c.node_id} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-1.5 text-xs">
                  <span className="mono truncate text-slate-700">{c.node_id}</span>
                  <span className={stateClass(c.state)}>{stateLabel(c.state)} · {fmtNum(c.tests_total)} test</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Kegagalan */}
        {data.topFailures.length ? (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Kegagalan utama</h2>
            <table className="mt-2 w-full text-left text-xs">
              <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-1.5">Test</th><th className="py-1.5">Kategori</th><th className="py-1.5">Pesan</th></tr></thead>
              <tbody>
                {data.topFailures.map((f) => (
                  <tr key={f.title + f.file} className="border-b border-slate-100 align-top">
                    <td className="py-1.5 pr-3 text-slate-700">{f.title}<div className="mono text-[10px] text-slate-400">{f.file}</div></td>
                    <td className="py-1.5 pr-3"><span className="rounded bg-slate-100 px-1.5 py-0.5">{f.error_category ?? "—"}</span></td>
                    <td className="py-1.5 text-slate-600">{f.error_message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <footer className="mt-10 border-t border-slate-200 pt-4 text-[11px] leading-relaxed text-slate-500">
          <span className="inline-block bg-amber-100 text-amber-900 px-2 py-0.5 rounded text-xs font-semibold mb-2">SIMULASI</span>
          <br />
          Laporan ini dibuat otomatis oleh Veriflow untuk run #{data.run.id.slice(-6)}.
          Struktur basis data, nama kolom, dan hostname internal tidak disertakan pada laporan untuk audiens customer
          (kebijakan privasi arsitektur). Tautan bertanda tangan ini kedaluwarsa dalam 14 hari.
          <br />Butuh akses dashboard? Hubungi tim QA pemilik project.
          <br /><strong>Catatan:</strong> Data biaya, PR, dan model AI adalah simulasi (mock). Konfigurasikan OPENAI_API_KEY/ANTHROPIC_API_KEY untuk data nyata.
        </footer>
      </div>
    </div>
  );
}

function narrative(s: RunSummary): string {
  const cat = Object.entries(s.categories ?? {}).sort((a, b) => b[1] - a[1]);
  const dom = cat[0]?.[0] ?? "product_bug";
  return `${s.passed} dari ${s.total} test lulus (${fmtPct(s.pass_rate, 1)}) dalam ${fmtDuration(s.duration_ms)}. ` +
    (s.failed === 0
      ? "Tidak ada kegagalan; pipeline siap dipromosikan ke lingkungan berikutnya. "
      : `Gagal didominasi oleh kategori ${dom} (${cat[0]?.[1] ?? 0} kasus) yang perlu ditangani sebelum rilis. `) +
    (s.flaky ? `Sebanyak ${s.flaky} test tidak stabil dan sementara dikecualikan dari verdict agar tidak memblokir, namun tetap dipantau. ` : "") +
    (cat.some(([k]) => k === "infra") ? "Sebagian kegagalan berasal dari infrastruktur runner, sehingga angka ini belum final. " : "") +
    "Rekomendasi: perbaiki kasus beresolusi product_bug terlebih dahulu, lalu stabilkan test flaky sebelum menaikkan cakupan.";
}

const stateClass = (s: string) =>
  s === "passed" ? "text-emerald-700" : s === "failed" ? "text-red-700" : s === "flaky" ? "text-amber-700" : "text-slate-500";
const stateLabel = (s: string) =>
  s === "passed" ? "lulus" : s === "failed" ? "ada gagal" : s === "flaky" ? "flaky" : "tanpa test";
