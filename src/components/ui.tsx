import type { ReactNode } from "react";

export const panel = "panel";

export function Card({ children, className = "", hover = false }: { children: ReactNode; className?: string; hover?: boolean }) {
  return <section className={`panel ${hover ? "panel-hover" : ""} ${className}`}>{children}</section>;
}

export function CardHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-slate-100">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
      </div>
      {right}
    </header>
  );
}

export function Kpi({ label, value, delta, tone = "cyan", icon }: {
  label: string; value: ReactNode; delta?: ReactNode; tone?: "cyan" | "amber" | "go" | "hold" | "stop"; icon?: ReactNode;
}) {
  const tones = {
    cyan: "text-dispatch", amber: "text-amber-glow", go: "text-go", hold: "text-hold", stop: "text-stop",
  };
  return (
    <Card hover className="relative overflow-hidden p-4">
      <div className="flex items-start justify-between">
        <span className="kpi-label">{label}</span>
        {icon ? <span className={`${tones[tone]} opacity-70`}>{icon}</span> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-50">{value}</div>
      {delta ? <div className="mt-1 text-xs text-slate-400">{delta}</div> : null}
      <div className={`absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent`} />
      <div className="absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-white/[0.02] blur-2xl" />
    </Card>
  );
}

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  passed: { color: "#22c55e", label: "passed" },
  COMPLETED: { color: "#22c55e", label: "completed" },
  failed: { color: "#ef4444", label: "failed" },
  FAILED: { color: "#ef4444", label: "failed" },
  flaky: { color: "#eab308", label: "flaky" },
  skipped: { color: "#64748b", label: "skipped" },
  COMPLETED_WITH_WARNINGS: { color: "#eab308", label: "warnings" },
  WAITING_APPROVAL: { color: "#f59e0b", label: "waiting approval" },
  CANCELLED: { color: "#64748b", label: "cancelled" },
  TIMED_OUT: { color: "#ef4444", label: "timed out" },
  CREATED: { color: "#64748b", label: "created" },
  QUEUED: { color: "#64748b", label: "queued" },
  RUNNING: { color: "#22d3ee", label: "running" },
};

const RUNNING_STATUSES = new Set([
  "CLONING", "ANALYZING", "SCAFFOLDING", "PLANNING", "GENERATING", "VALIDATING", "HEALING",
  "COMMITTING", "PROVISIONING", "EXECUTING", "ANALYZING_RESULTS", "REPORTING", "NOTIFYING",
]);

export function StatusChip({ status, pulse = true }: { status: string; pulse?: boolean }) {
  const st = STATUS_STYLE[status] ?? { color: RUNNING_STATUSES.has(status) ? "#22d3ee" : "#64748b", label: status.toLowerCase().replace(/_/g, " ") };
  const live = RUNNING_STATUSES.has(status) || status === "RUNNING";
  return (
    <span className="chip" style={{ color: st.color, borderColor: `${st.color}55`, background: `${st.color}12` }}>
      <span className={`h-1.5 w-1.5 rounded-full ${live && pulse ? "pulse-dot" : ""}`} style={{ background: st.color }} />
      {st.label}
    </span>
  );
}

export function CategoryChip({ category }: { category: string | null }) {
  if (!category) return null;
  const colors: Record<string, string> = {
    product_bug: "#ef4444", test_bug: "#f59e0b", env_issue: "#3b82f6",
    data_issue: "#a855f7", infra: "#64748b", flaky: "#eab308",
  };
  const c = colors[category] ?? "#64748b";
  return (
    <span className="chip" style={{ color: c, borderColor: `${c}55`, background: `${c}12` }}>
      {category.replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="relative h-14 w-14 rounded-xl border border-dashed border-slate-600">
        <div className="absolute inset-0 flex items-center justify-center text-slate-600">◇</div>
      </div>
      <p className="text-sm text-slate-300">{title}</p>
      {hint ? <p className="max-w-md text-xs text-slate-500">{hint}</p> : null}
      {action}
    </div>
  );
}