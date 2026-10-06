import Link from "next/link";
import { Card, CardHead, EmptyState, StatusChip } from "@/components/ui";
import { all, one } from "@/lib/db";
import { fmtDate } from "@/lib/util";
import { emailStats } from "@/lib/mailer";
import { EmailPreview } from "@/components/email-preview";

export const dynamic = "force-dynamic";

/** Email Center: log pengiriman, preview, resend (FR-DSH-08). */
export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const rows = all<Record<string, any>>(
    `SELECT e.*, r.project_id FROM email_messages e LEFT JOIN runs r ON r.id = e.run_id
     ORDER BY e.created_at DESC LIMIT 100`);
  const stats = emailStats();
  const selected = sp.id ? one<Record<string, any>>("SELECT * FROM email_messages WHERE id = ?", [sp.id]) : rows[0];
  const bounced = one<{ n: number }>("SELECT COUNT(*) n FROM email_messages WHERE status='bounced'")?.n ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <p className="kpi-label">Email Center</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-50">Laporan otomatis ke stakeholder</h1>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Setiap run selesai mengirim ringkasan + link report bertanda tangan. Idempotency key
          <span className="mono mx-1 text-slate-400">run_id:kind:recipient</span>
          menjamin tidak ada email ganda saat retry. Provider default: outbox (DB) — ganti ke Resend/SMTP lewat env.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {["queued", "sent", "delivered", "bounced", "complained"].map((s) => (
          <Card key={s} className="p-4">
            <p className="kpi-label">{s}</p>
            <p className="mt-1 text-xl font-semibold text-slate-50">{stats[s] ?? 0}</p>
          </Card>
        ))}
      </div>

      {bounced > 0 ? (
        <div className="panel border-stop/30 p-4 text-xs text-stop">
          {bounced} email bounce terdeteksi. Alamat bermasalah sebaiknya dimasukkan ke bounce list agar tidak dikirim ulang
          (retry exponential 5× lalu dead-letter, PRD BP-13).
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHead title="Log pengiriman" sub="100 pesan terakhir" />
          {rows.length ? (
            <ul className="max-h-[34rem] space-y-1 overflow-auto px-3 pb-4">
              {rows.map((r) => (
                <li key={String(r.id)}>
                  <Link
                    href={`/emails?id=${r.id}`}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 transition hover:bg-white/[0.04] ${selected?.id === r.id ? "bg-dispatch/10" : ""}`}
                  >
                    <StatusChip status={String(r.status) === "sent" ? "passed" : "skipped"} pulse={false} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-slate-200">{String(r.subject)}</p>
                      <p className="mono truncate text-[10px] text-slate-500">
                        {String(r.to_email)} · {String(r.kind)} · {fmtDate(String(r.created_at), "id-ID")}
                        {r.run_id ? ` · run #${String(r.run_id).slice(-6)}` : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Belum ada email" hint="Kirim run pertama untuk melihat laporan masuk ke sini." />}
        </Card>

        <Card className="lg:col-span-3">
          <CardHead
            title="Preview template"
            sub={selected ? `${selected.kind} → ${selected.to_email}` : undefined}
            right={selected?.run_id ? (
              <div className="flex gap-2">
                <Link href={`/runs/${selected.run_id}`} className="btn btn-ghost text-xs">Buka run</Link>
                <a href={`/api/v1/runs/${selected.run_id}/emails/resend`} className="btn btn-ghost text-xs"
                  onClick={undefined} title="Gunakan tombol Resend pada halaman run">Resend</a>
              </div>
            ) : null}
          />
          {selected ? <EmailPreview html={String(selected.body_html ?? "")} /> : <EmptyState title="Pilih pesan" />}
        </Card>
      </div>
    </div>
  );
}