/** Konfigurasi adapter terpusat: satu tempat untuk melihat mode live/mock (UI Settings). */
export type EnvInfo = { key: string; value: string; mock: boolean; description: string };

export function env(): EnvInfo[] {
  const e = process.env;
  const rows: Array<[string, string | undefined, string]> = [
    ["LLM_PROVIDER", e.LLM_PROVIDER, "mock | anthropic"],
    ["GIT_PROVIDER", e.GIT_PROVIDER, "mock | github"],
    ["EMAIL_PROVIDER", e.EMAIL_PROVIDER, "outbox | resend | smtp"],
    ["RUNNER_PROVIDER", e.RUNNER_PROVIDER, "none | http"],
    ["ANTHROPIC_API_KEY", e.ANTHROPIC_API_KEY, "—"],
    ["GITHUB_PAT", e.GITHUB_PAT, "—"],
    ["RESEND_API_KEY", e.RESEND_API_KEY, "—"],
    ["RUNNER_URL", e.RUNNER_URL, "—"],
    ["VERIFLOW_DB_PATH", e.VERIFLOW_DB_PATH, "—"],
    ["PUBLIC_BASE_URL", e.PUBLIC_BASE_URL, "—"],
  ];
  return rows.map(([key, value, description]) => ({
    key,
    value: key.includes("KEY") || key.includes("PAT") || key.includes("SECRET") ? (value ? "••••••••" : "") : (value ?? ""),
    mock: value === undefined || value === "" || value === "mock" || value === "outbox" || value === "none",
    description,
  }));
}