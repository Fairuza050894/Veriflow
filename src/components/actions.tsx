"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as Record<string, unknown>;
}

export function RunButton({ projectId, label = "Jalankan Run" }: { projectId: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="relative inline-flex flex-col">
      <button
        className="btn btn-primary"
        disabled={busy || pending}
        onClick={() => {
          setBusy(true); setErr(null);
          start(async () => {
            try {
              const r = await post(`/api/v1/projects/${projectId}/runs`);
              router.push(`/runs/${r.runId}`);
              router.refresh();
            } catch (e) {
              setErr((e as Error).message);
              setBusy(false);
            }
          });
        }}
      >
        {busy ? <Spinner /> : "▶"} {label}
      </button>
      {err ? <span className="absolute left-0 top-full z-20 mt-1 whitespace-nowrap text-[11px] text-stop">{err}</span> : null}
    </span>
  );
}

export function ConnectRepoButton({ label = "Connect Repo" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [repoUrl, setRepoUrl] = useState("https://github.com/logistics-id/logitrack-web");
  const [branch, setBranch] = useState("main");
  const [baseUrl, setBaseUrl] = useState("https://staging.logitrack.io");
  const [recipients, setRecipients] = useState("qa@logistics-id.com, ops@logitrack.io");
  const [mode, setMode] = useState("FULL_AUTO");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  if (!open) {
    return <button className="btn btn-ghost" onClick={() => setOpen(true)}>＋ {label}</button>;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-night-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal>
      <div className="panel rise w-full max-w-2xl p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-50">Wizard — Connect Repo</h2>
            <p className="mt-0.5 text-xs text-slate-500">Tiga langkah, tanpa setup manual. Auto-detect mengisi sisanya.</p>
          </div>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(false)}>✕</button>
        </div>

        <ol className="mt-5 grid grid-cols-3 gap-2 text-center text-[11px] font-semibold">
          {["Hubungkan repo", "Konfirmasi deteksi", "Jalankan"].map((s, i) => (
            <li key={s} className="rounded-lg border border-slate-700/60 bg-night-800/60 px-2 py-2 text-slate-300">
              <span className="mono mr-1 text-dispatch">{i + 1}</span>{s}
            </li>
          ))}
        </ol>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="kpi-label">URL repository</span>
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)}
              className="mono mt-1 w-full rounded-lg border border-slate-700 bg-night-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-dispatch"
              placeholder="https://github.com/org/repo" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="kpi-label">Branch</span>
              <input value={branch} onChange={(e) => setBranch(e.target.value)}
                className="mono mt-1 w-full rounded-lg border border-slate-700 bg-night-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-dispatch" />
            </label>
            <label className="block">
              <span className="kpi-label">Base URL target</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                className="mono mt-1 w-full rounded-lg border border-slate-700 bg-night-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-dispatch" />
            </label>
          </div>
          <label className="block">
            <span className="kpi-label">Penerima laporan (dipisah koma)</span>
            <input value={recipients} onChange={(e) => setRecipients(e.target.value)}
              className="mono mt-1 w-full rounded-lg border border-slate-700 bg-night-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-dispatch" />
          </label>
          <div>
            <span className="kpi-label">Mode operasi</span>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {[
                { id: "FULL_AUTO", label: "Full-Auto", hint: "generate → run → email, PR otomatis" },
                { id: "REVIEW_GATE", label: "Review-Gate", hint: "tunggu approve engineer" },
                { id: "REPORT_ONLY", label: "Report-Only", hint: "hanya jalankan test existing" },
              ].map((m) => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${mode === m.id ? "border-dispatch bg-dispatch/10" : "border-slate-700 hover:border-slate-500"}`}>
                  <div className="text-xs font-semibold text-slate-100">{m.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {err ? <p className="mt-4 rounded-lg border border-stop/30 bg-stop/10 px-3 py-2 text-xs text-stop">{err}</p> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>Batal</button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setErr(null);
              try {
                const r = await post("/api/v1/projects/quick-run", {
                  repo_url: repoUrl,
                  branch,
                  base_url: baseUrl,
                  recipients: recipients.split(",").map((s) => s.trim()).filter(Boolean),
                  mode,
                });
                router.push(`/runs/${r.runId}`);
                router.refresh();
              } catch (e) {
                setErr((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : "▶"} Connect & Run
          </button>
        </div>
      </div>
    </div>
  );
}

export function CancelButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-ghost px-2.5 py-1 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post(`/api/v1/runs/${runId}/cancel`).catch(() => {});
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "..." : "Batalkan"}
    </button>
  );
}

export function ReviewButtons({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (d: "approve" | "reject") => {
    setBusy(d); setErr(null);
    try {
      await post(`/api/v1/runs/${runId}/${d}`, { reviewer: "engineer" });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <button className="btn btn-primary" disabled={busy !== null} onClick={() => act("approve")}>
        {busy === "approve" ? <Spinner /> : "✓"} Setujui
      </button>
      <button className="btn btn-ghost" disabled={busy !== null} onClick={() => act("reject")}>✕ Tolak</button>
      {err ? <span className="text-xs text-stop">{err}</span> : null}
    </div>
  );
}

export function ResendButton({ runId }: { runId: string }) {
  const [state, setState] = useState<string>("");
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-ghost px-2.5 py-1 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true); setState("");
        try {
          const r = await post(`/api/v1/runs/${runId}/emails/resend`);
          setState(`Terkirim ke ${(r.sentTo as string[]).join(", ")}`);
        } catch (e) {
          setState((e as Error).message);
        } finally { setBusy(false); }
      }}
    >
      {busy ? <Spinner /> : "↻ Kirim ulang"}
      {state ? <span className="ml-1 text-[11px] text-slate-400">{state}</span> : null}
    </button>
  );
}

function Spinner() {
  return <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}