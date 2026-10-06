import type { RunSummary, Diagram } from "./types";
import type { CoverageEntry } from "./contracts";
import type { Audience } from "./types";
import { t, type Lang } from "./i18n";
import { fmtPct, fmtDuration } from "./util";
import type { EmailPayload } from "./mailer";
import { maskSecrets } from "./mailer";

export type ReportInput = {
  runId: string;
  projectName: string;
  envName: string;
  commit: string;
  branch: string;
  summary: RunSummary;
  diagrams: Array<Pick<Diagram, "kind" | "title" | "alt_text" | "in_email"> & { audience: Audience }>;
  reportUrl: string;
  locale: Lang;
};

export function buildReportEmail(input: ReportInput): { subject: string; preheader: string; html: string; text: string } {
  const { summary: s, locale } = input;
  const ok = s.failed === 0 && s.flaky === 0;
  const icon = ok ? "✅" : s.failed ? "❌" : "⚠️";
  const subject = `[Veriflow] ${input.projectName} — ${icon} ${s.passed}/${s.total} lulus (${fmtPct(s.pass_rate)}) · Run ${input.runId.slice(-6)} · ${input.envName}`;

  const delta = s.delta_pass_rate === null ? "" :
    s.delta_pass_rate >= 0 ? `▲ +${fmtPct(s.delta_pass_rate)} dari run sebelumnya` : `▼ ${fmtPct(Math.abs(s.delta_pass_rate))} dari run sebelumnya`;

  const aiSummary = buildAiSummary(input);
  const emailDiagrams = input.diagrams.filter((d) => d.in_email && d.alt_text);
  const diagramBlocks = emailDiagrams.map((d) => `
    <tr><td style="padding:18px 0 6px">
      <div style="font:600 15px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">${esc(d.title)}</div>
      <div style="font:400 12px/1.5 -apple-system,sans-serif;color:#64748b;margin:2px 0 10px">${esc(d.alt_text!)}</div>
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;background:#f8fafc;font:400 12px/1.5 ui-monospace,Menlo,monospace;color:#0f172a">${esc(previewOf(d.kind))}</div>
    </td></tr>`).join("");

  const topFail = s.top_failures.map((f) => `
    <tr><td style="padding:8px 0;border-bottom:1px solid #eef2f6">
      <div style="font:600 13px/1.4 sans-serif;color:#0f172a">${esc(f.title)}</div>
      <div style="font:400 12px/1.5 sans-serif;color:#64748b">${badge(f.category)} · ${esc(f.message.slice(0, 120))}</div>
    </td></tr>`).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9">
<div style="display:none;max-height:0;overflow:hidden">${esc(aiSummary.short)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
    <tr><td style="background:linear-gradient(120deg,#0b1220,#132033);padding:22px 26px;color:#fff">
      <div style="font:700 18px/1.2 sans-serif;letter-spacing:.3px">VERIFLOW</div>
      <div style="font:400 12px/1.5 sans-serif;color:#94a3b8;margin-top:4px">${esc(t(locale, "brand.tagline"))}</div>
    </td></tr>
    <tr><td style="padding:24px 26px">
      <div style="font:600 16px/1.4 sans-serif;color:#0f172a">${esc(input.projectName)} · ${esc(input.envName)}</div>
      <div style="font:400 12px/1.6 sans-serif;color:#64748b;margin-top:4px">
        Commit <code>${esc(input.commit.slice(0, 7))}</code> · Branch ${esc(input.branch)} · Durasi ${esc(fmtDuration(s.duration_ms))}
      </div>

      <table role="presentation" width="100%" style="margin:18px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:16px">
        <table role="presentation" width="100%"><tr>
          ${stat("Total", s.total)}${stat("Lulus", s.passed, "#1C7A4B")}${stat("Gagal", s.failed, s.failed ? "#B3261E" : "#94a3b8")}${stat("Flaky", s.flaky, s.flaky ? "#9A6200" : "#94a3b8")}${stat("Skip", s.skipped)}
        </tr></table>
        <div style="font:600 15px/1.4 sans-serif;color:#0f172a;margin-top:14px">Pass rate ${fmtPct(s.pass_rate)} ${delta && `<span style="font-size:12px;color:${(s.delta_pass_rate ?? 0) >= 0 ? "#1C7A4B" : "#B3261E"}">${esc(delta)}</span>`}</div>
        <div style="height:8px;background:#e2e8f0;border-radius:99px;margin-top:8px;overflow:hidden">
          <div style="height:8px;width:${Math.round(s.pass_rate * 100)}%;background:linear-gradient(90deg,#1C7A4B,#2f9e6b)"></div>
        </div>
      </td></tr></table>

      <div style="font:600 14px/1.5 sans-serif;color:#0f172a;margin-bottom:6px">Ringkasan AI</div>
      <div style="font:400 14px/1.7 sans-serif;color:#334155">${esc(aiSummary.text)}</div>

      ${diagramBlocks}

      ${topFail ? `<div style="font:600 14px/1.5 sans-serif;color:#0f172a;margin:22px 0 6px">Top kegagalan</div><table role="presentation" width="100%">${topFail}</table>` : ""}

      <table role="presentation" width="100%" style="margin-top:24px"><tr><td align="center">
        <a href="${esc(input.reportUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font:600 14px sans-serif">${esc(t(locale, "action.viewReport"))} →</a>
      </td></tr></table>
    </td></tr>
    <tr><td style="padding:16px 26px;background:#f8fafc;border-top:1px solid #e2e8f0;font:400 11px/1.7 sans-serif;color:#94a3b8">
      Report lengkap dibuka lewat tautan bertanda tangan (kedaluwarsa 14 hari) — bukan lampiran.
      <br/>Dikirim oleh Veriflow · Jalankan otomatis atas nama tim QA Anda.
    </td></tr>
  </table>
</td></tr></table></body></html>`;

  const text = `${subject}

${input.projectName} · ${input.envName} · commit ${input.commit.slice(0, 7)}
Total ${s.total} | Lulus ${s.passed} | Gagal ${s.failed} | Flaky ${s.flaky} | Skip ${s.skipped}
Pass rate ${fmtPct(s.pass_rate)}

${aiSummary.text}

Top kegagalan:
${s.top_failures.map((f) => ` - ${f.title} (${f.category}): ${f.message}`).join("\n") || " - tidak ada"}

Report lengkap: ${input.reportUrl}
`;

  return { subject, preheader: aiSummary.short, html: maskSecrets(html), text };
}

/** FR-RPT-03 — ringkasan AI deterministik (mock summarizer, tanpa LLM). */
function buildAiSummary(input: ReportInput) {
  const s = input.summary;
  const cat = Object.entries(s.categories).sort((a, b) => b[1] - a[1]);
  const dominant = cat[0]?.[0] ?? "product_bug";
  const short = `${s.failed} gagal, ${s.flaky} flaky. ${cat.slice(0, 2).map(([k, v]) => `${v} ${k}`).join(", ")}.`;
  const t2 = input.locale === "id"
    ? `Ringkasan: ${s.passed} dari ${s.total} test lulus (${fmtPct(s.pass_rate)}), durasi ${fmtDuration(s.duration_ms)}. ` +
      (s.failed === 0 ? "Tidak ada kegagalan; pipeline siap dipromosikan." : `Gagal didominasi oleh ${dominant} (${cat[0]?.[1] ?? 0} kasus). `) +
      (s.flaky ? `Sebanyak ${s.flaky} test flaky; masukkan ke quarantine sampai 10 run hijau berturut-turut. ` : "") +
      (cat.some(([k]) => k === "infra") ? "Terdapat kegagalan infrastruktur — cek kesehatan runner sebelum hasil dianggap final. " : "") +
      "Rekomendasi: perbaiki kasus beresolusi product_bug terlebih dahulu, lalu stabilkan test berlabel flaky."
    : `Summary: ${s.passed} of ${s.total} tests passed (${fmtPct(s.pass_rate)}) in ${fmtDuration(s.duration_ms)}. ` +
      (s.failed === 0 ? "No failures; pipeline is promotion-ready." : `Failures are dominated by ${dominant} (${cat[0]?.[1] ?? 0} cases). `) +
      (s.flaky ? `${s.flaky} flaky tests should be quarantined until 10 consecutive green runs. ` : "") +
      "Recommendation: fix product_bug cases first, then stabilise flaky tests.";
  return { short: maskSecrets(short), text: maskSecrets(t2) };
}

export function buildFailureEmail(input: { projectName: string; envName: string; reason: string; runId: string; locale: Lang }): EmailPayload["subject"] extends never ? never : { subject: string; html: string; text: string } {
  const s = `[Veriflow] ${input.projectName} — ⚠️ Run ${input.runId.slice(-6)} tidak dapat diselesaikan`;
  const html = `<!doctype html><html><body style="font-family:sans-serif;background:#f1f5f9;padding:24px">
  <div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px;border-left:4px solid #B3261E">
    <div style="font:700 16px sans-serif;color:#0f172a">Veriflow tidak dapat menyelesaikan run</div>
    <p style="font:400 14px/1.6 sans-serif;color:#334155">Project <b>${esc(input.projectName)}</b> pada environment <b>${esc(input.envName)}</b> gagal karena masalah infrastruktur platform.</p>
    <pre style="background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;font:12px ui-monospace,monospace;overflow:auto">${esc(maskSecrets(input.reason))}</pre>
    <p style="font:400 13px/1.6 sans-serif;color:#64748b">Pelanggan tidak boleh tanpa kabar: tim kami sudah diberi tahu dan akan menindaklanjuti. Jalankan ulang dari dashboard kapan saja.</p>
  </div></body></html>`;
  const text = `${s}\n\nReason: ${maskSecrets(input.reason)}\n\nTim sudah diberi tahu. Jalankan ulang dari dashboard.`;
  return { subject: s, html, text };
}

function stat(label: string, value: number, color = "#0f172a") {
  return `<td align="center"><div style="font:700 22px/1.1 sans-serif;color:${color}">${value}</div><div style="font:400 11px/1.4 sans-serif;color:#64748b;margin-top:4px">${esc(label)}</div></td>`;
}
function badge(cat: string) {
  const colors: Record<string, string> = { product_bug: "#B3261E", test_bug: "#9A6200", env_issue: "#1D4ED8", data_issue: "#7C3AED", infra: "#64748B", flaky: "#A16207" };
  const c = colors[cat] ?? "#64748B";
  return `<span style="display:inline-block;background:${c}15;color:${c};border-radius:5px;padding:1px 6px;font:600 10px sans-serif">${esc(cat)}</span>`;
}
function previewOf(kind: string) {
  return {
    D01: "┌──── Docker / Container graph ────┐\n web(3000) ──depends_on──> api\n api ──lives_in──> postgres:16\n api ──depends_on──> redis",
    D09: "✔ 31/31 web · ✖ 2/9 api · ✔ 12/12 db · 0 test payment",
    D07: "push → lint → typecheck → unit → build → scan → deploy-staging → deploy-prod",
    D08: "web :3000 · api · postgres(16-alpine) · redis(7-alpine)",
  }[kind] ?? "diagram tersimpan sebagai sumber Mermaid di dashboard";
}
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");