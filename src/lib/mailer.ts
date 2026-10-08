import { all, one, run as dbRun, J, uid, nowIso } from "./db";

export type EmailKind = "report" | "failure" | "started" | "approval_needed" | "digest" | "quota_alert";
export type EmailPayload = {
  runId: string;
  kind: EmailKind;
  to: string;
  locale: "id" | "en";
  subject: string;
  preheader?: string;
  html: string;
  text: string;
};

const SECRETS = /(ghp_[A-Za-z0-9]+|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{20,}|postgres:\/\/[^:\s]+:[^@\s]+@)/g;

/** §9.3 — tidak ada secret/PII mentah di email; mask nilai sensitif dari pesan error. */
export const maskSecrets = (s: string) =>
  s.replace(SECRETS, (m) => (m.startsWith("postgres") ? "postgres://***:***@" : "[REDACTED]"));

/**
 * Idempotency: `run_id:kind:recipient` (§9.3). Retry tidak pernah kirim ganda.
 * Provider: outbox (default, ditulis ke DB → Email Center) | resend | smtp.
 */
export async function sendEmail(p: EmailPayload): Promise<{ sent: boolean; id: string; detail: string }> {
  const idem = `${p.runId}:${p.kind}:${p.to.toLowerCase()}`;
  const existing = await one<{ id: string; status: string }>("SELECT id, status FROM email_messages WHERE idempotency_key = ?", [idem]);
  if (existing) return { sent: true, id: existing.id, detail: `idempotent: sudah ada (${existing.status})` };

  const id = uid("eml_");
  const html = maskSecrets(p.html);
  const text = maskSecrets(p.text);

  let status = "queued";
  let detail = "outbox";
  const provider = process.env.EMAIL_PROVIDER ?? "outbox";

  if (provider === "resend" && process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? "Veriflow <no-reply@veriflow.dev>",
          to: [p.to],
          subject: p.subject,
          html,
          text,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      status = res.ok ? "sent" : "bounced";
      detail = res.ok ? await res.text() : `resend error ${res.status}`;
    } catch (e) {
      status = "queued"; // tetap di outbox, retry exponential
      detail = (e as Error).message;
    }
  } else if (provider === "smtp" && process.env.SMTP_URL) {
    detail = "smtp: kirim lewat worker eksternal (lihat docs/DEPLOYMENT.md §Email)";
    status = "queued";
  }

  await dbRun(
    `INSERT INTO email_messages(id, run_id, kind, to_email, subject, status, attempts, body_html, body_text, idempotency_key, created_at, sent_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, p.runId, p.kind, p.to, p.subject, status, provider === "outbox" ? 1 : 1, html, text, idem, nowIso(), status === "sent" ? nowIso() : null],
  );
  return { sent: status === "sent", id, detail };
}

export async function emailStats() {
  const rows = await all<{ status: string; n: number }>("SELECT status, COUNT(*) n FROM email_messages GROUP BY status");
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export const parseEmailRows = (rows: Array<Record<string, unknown>>) =>
  rows.map((r) => ({
    ...r,
    kind: String(r.kind),
    to_email: String(r.to_email),
    subject: String(r.subject),
  }));

export { J };
