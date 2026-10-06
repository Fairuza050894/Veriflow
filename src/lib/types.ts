// Kontrak domain bersama. Satu sumber kebenaran untuk bentuk data antar-step.

export type Mode = "FULL_AUTO" | "REVIEW_GATE" | "REPORT_ONLY";
export type RunStatus =
  | "CREATED" | "QUEUED" | "CLONING" | "ANALYZING" | "SCAFFOLDING" | "PLANNING"
  | "GENERATING" | "VALIDATING" | "HEALING" | "WAITING_APPROVAL" | "COMMITTING"
  | "PROVISIONING" | "EXECUTING" | "ANALYZING_RESULTS" | "REPORTING" | "NOTIFYING"
  | "COMPLETED" | "COMPLETED_WITH_WARNINGS" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export type TestStatus = "passed" | "failed" | "flaky" | "skipped" | "timedout";
export type ErrorCategory =
  | "product_bug" | "test_bug" | "env_issue" | "data_issue" | "flaky" | "infra";
export type Audience = "internal" | "customer" | "public";
export type DiagramKind = "D01" | "D02" | "D03" | "D04" | "D05" | "D06" | "D07" | "D08" | "D09" | "D10";

export const RUN_STEPS = [
  "CLONING", "ANALYZING", "SCAFFOLDING", "PLANNING", "GENERATING", "VALIDATING",
  "HEALING", "WAITING_APPROVAL", "COMMITTING", "PROVISIONING", "EXECUTING",
  "ANALYZING_RESULTS", "REPORTING", "NOTIFYING",
] as const;
export type StepName = (typeof RUN_STEPS)[number];

export type StepMeta = {
  name: StepName;
  timeoutMs: number;
  retries: number;
  /** toleransi detach: gagal tidak mematikan run */
  optional?: boolean;
  /** batas keras; lewat batas → lanjut tanpa output (mis. diagram) */
  budgetMs?: number;
};

// Tabel timeout/retry dari PRD §4.1 / Arsitektur §18.14
export const STEP_META: Record<StepName, StepMeta> = {
  CLONING: { name: "CLONING", timeoutMs: 300_000, retries: 3 },
  ANALYZING: { name: "ANALYZING", timeoutMs: 600_000, retries: 2 },
  SCAFFOLDING: { name: "SCAFFOLDING", timeoutMs: 180_000, retries: 2 },
  PLANNING: { name: "PLANNING", timeoutMs: 300_000, retries: 3 },
  GENERATING: { name: "GENERATING", timeoutMs: 1_800_000, retries: 2 },
  VALIDATING: { name: "VALIDATING", timeoutMs: 900_000, retries: 1 },
  HEALING: { name: "HEALING", timeoutMs: 600_000, retries: 3 },
  WAITING_APPROVAL: { name: "WAITING_APPROVAL", timeoutMs: 86_400_000, retries: 0 },
  COMMITTING: { name: "COMMITTING", timeoutMs: 180_000, retries: 3 },
  PROVISIONING: { name: "PROVISIONING", timeoutMs: 300_000, retries: 3 },
  EXECUTING: { name: "EXECUTING", timeoutMs: 3_600_000, retries: 2 },
  ANALYZING_RESULTS: { name: "ANALYZING_RESULTS", timeoutMs: 300_000, retries: 2 },
  REPORTING: { name: "REPORTING", timeoutMs: 600_000, retries: 3 },
  NOTIFYING: { name: "NOTIFYING", timeoutMs: 600_000, retries: 5 },
};

export type Organization = { id: string; name: string; plan: string; created_at: string };
export type Project = {
  id: string; org_id: string; name: string;
  repo_provider: string; repo_url: string; default_branch: string; subfolder: string | null;
  mode: Mode; scaffold_root: string; settings: Record<string, unknown>;
  detected: Record<string, unknown> | null; created_at: string;
};
export type Environment = {
  id: string; project_id: string; name: string; base_url: string; api_base_url: string;
  auth_strategy: string; read_only: number; egress_allowlist: string[] | null;
};
export type Recipient = { id: string; project_id: string; email: string; kind: string; locale: string; verified_at: string | null };
export type Run = {
  id: string; project_id: string; environment_id: string | null; trigger: string;
  commit_sha: string; branch: string; mode: Mode; status: RunStatus;
  idempotency_key: string; started_at: string | null; finished_at: string | null;
  summary: Record<string, unknown> | null; cost: Record<string, unknown> | null;
  report_url: string | null; error: unknown; created_at: string;
};
export type RunStep = {
  id: string; run_id: string; name: StepName; status: string;
  attempt: number; started_at: string | null; finished_at: string | null; detail: Record<string, unknown> | null;
};
export type TestResult = {
  id: string; run_id: string; file: string; title: string; layer: "ui" | "api" | "e2e";
  tags: string[]; status: TestStatus; duration_ms: number; retries: number;
  error_message: string | null; error_category: ErrorCategory | null;
  prompt_version: string | null; model: string | null; quarantined: number;
  covers: string[] | null;
};
export type EmailMessage = {
  id: string; run_id: string | null; kind: string; to_email: string; subject: string;
  status: string; attempts: number; body_html: string | null; body_text: string | null;
  idempotency_key: string; created_at: string; sent_at: string | null;
};
export type Diagram = {
  id: string; snapshot_id: string; run_id: string; kind: DiagramKind; title: string;
  audience: Audience; syntax: string; source: string; node_count: number;
  truncated: number; ai_summary: string | null; status: string; in_email: number;
  alt_text: string | null;
};
export type ArchFinding = {
  id: string; snapshot_id: string; code: string; severity: string; title: string;
  detail: string; nodes: string[]; evidence: Array<{ file: string; line?: number }>;
};

export type RunSummary = {
  total: number; passed: number; failed: number; flaky: number; skipped: number;
  duration_ms: number; pass_rate: number; delta_pass_rate: number | null;
  categories: Record<string, number>; top_failures: Array<{ title: string; file: string; category: string; message: string }>;
};
export type RunCost = { tokens_in: number; tokens_out: number; cost_usd: number; runner_seconds: number; ai_calls: number };