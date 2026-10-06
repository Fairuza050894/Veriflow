-- Veriflow schema (SQLite / node:sqlite). DipSubset dari PostgreSQL di Arsitektur §6 & §18.12:
-- JSONB -> TEXT, timestamptz -> TEXT ISO-8601, uuid -> TEXT, citext -> TEXT.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL, repo_provider TEXT NOT NULL DEFAULT 'github',
  repo_url TEXT NOT NULL, default_branch TEXT NOT NULL DEFAULT 'main', subfolder TEXT,
  mode TEXT NOT NULL DEFAULT 'FULL_AUTO', scaffold_root TEXT NOT NULL DEFAULT 'autoqa',
  settings TEXT NOT NULL DEFAULT '{}', detected TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
  base_url TEXT NOT NULL, api_base_url TEXT NOT NULL DEFAULT '',
  auth_strategy TEXT NOT NULL DEFAULT 'none', read_only INTEGER NOT NULL DEFAULT 0,
  egress_allowlist TEXT, secret_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_env_project ON environments(project_id);

CREATE TABLE IF NOT EXISTS recipients (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), email TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'to' CHECK (kind IN ('to','cc','bcc')),
  locale TEXT NOT NULL DEFAULT 'id', verified_at TEXT, unsubscribed_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), environment_id TEXT,
  trigger TEXT NOT NULL DEFAULT 'manual', commit_sha TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT 'main', mode TEXT NOT NULL DEFAULT 'FULL_AUTO',
  status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  started_at TEXT, finished_at TEXT, summary TEXT, cost TEXT,
  report_url TEXT, error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_idem ON runs(idempotency_key);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, finished_at TEXT, detail TEXT, seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_steps_run ON run_steps(run_id, seq);

CREATE TABLE IF NOT EXISTS run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id),
  step TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_run ON run_logs(run_id, id);

CREATE TABLE IF NOT EXISTS test_results (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), project_id TEXT NOT NULL,
  file TEXT NOT NULL, title TEXT NOT NULL, layer TEXT NOT NULL DEFAULT 'ui',
  tags TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0, error_message TEXT, error_category TEXT,
  prompt_version TEXT, model TEXT, quarantined INTEGER NOT NULL DEFAULT 0,
  covers TEXT, origin TEXT NOT NULL DEFAULT 'ai'
);
CREATE INDEX IF NOT EXISTS idx_tr_run ON test_results(run_id, status);
CREATE INDEX IF NOT EXISTS idx_tr_project ON test_results(project_id, status);

CREATE TABLE IF NOT EXISTS test_stats (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, file TEXT NOT NULL, title TEXT NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0, avg_duration_ms INTEGER NOT NULL DEFAULT 0,
  flaky_score REAL NOT NULL DEFAULT 0, consecutive_green INTEGER NOT NULL DEFAULT 0,
  last_status TEXT NOT NULL DEFAULT 'passed'
);

CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY, run_id TEXT, kind TEXT NOT NULL, to_email TEXT NOT NULL, subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  body_html TEXT, body_text TEXT, idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_email_run ON email_messages(run_id);

CREATE TABLE IF NOT EXISTS report_links (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), token_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT, expires_at TEXT NOT NULL, revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS arch_snapshots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT, commit_sha TEXT NOT NULL,
  model TEXT NOT NULL, node_count INTEGER NOT NULL DEFAULT 0, edge_count INTEGER NOT NULL DEFAULT 0,
  extractor_status TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arch_run ON arch_snapshots(run_id);

CREATE TABLE IF NOT EXISTS diagrams (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES arch_snapshots(id), run_id TEXT NOT NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'internal',
  syntax TEXT NOT NULL DEFAULT 'mermaid', source TEXT NOT NULL, node_count INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0, ai_summary TEXT, status TEXT NOT NULL DEFAULT 'ok',
  in_email INTEGER NOT NULL DEFAULT 0, alt_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_diagrams_run ON diagrams(run_id);

CREATE TABLE IF NOT EXISTS node_coverage (
  run_id TEXT NOT NULL, node_id TEXT NOT NULL, kind TEXT NOT NULL,
  tests_total INTEGER NOT NULL DEFAULT 0, passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0, flaky INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'untested',
  PRIMARY KEY (run_id, node_id)
);

CREATE TABLE IF NOT EXISTS arch_findings (
  id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, code TEXT NOT NULL, severity TEXT NOT NULL,
  title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', nodes TEXT NOT NULL DEFAULT '[]',
  evidence TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS devops_findings (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tool TEXT NOT NULL, severity TEXT NOT NULL,
  rule TEXT NOT NULL, location TEXT NOT NULL, message TEXT NOT NULL, fix_hint TEXT
);

CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step TEXT NOT NULL, prompt_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_run ON ai_calls(run_id);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, content_hash TEXT NOT NULL,
  path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);