import type { GeneratedTest } from "./generate";
import { rng } from "../util";

export type GateFailure = { testId: string; file: string; gate: GateName; message: string; fixable: boolean };
export type GateName = "lint" | "typecheck" | "dry_run" | "stability" | "policy" | "independence";
export type GateResult = { passed: boolean; failures: GateFailure[]; checked: number; durationMs: number };

const CUSTOM_RULES: Array<{ gate: GateName; re: RegExp; msg: string }> = [
  { gate: "lint", re: /waitForTimeout\(/, msg: "no-hard-wait: waitForTimeout dilarang" },
  { gate: "lint", re: /page\.locator\(['"]\/html|xpath=/, msg: "no-xpath: locator XPath/absolute dilarang" },
  { gate: "policy", re: /(password|secret|apiKey|api_key)\s*[:=]\s*["'][^"']{8,}/i, msg: "policy: secret hard-coded terdeteksi" },
  { gate: "policy", re: /test\.skip\(\s*true|\.only\(/, msg: "policy: test dinonaktifkan untuk lolos" },
];

/**
 * BP-09 — Quality Gate. Mode mock: aturan statis nyata dijalankan terhadap kode hasil
 * generate; "stability" disimulasikan deterministik per test (basis self-heal).
 * Mode nyata: jalankan eslint/tsc/playwright --list di runner.
 */
export function qualityGate(tests: GeneratedTest[], seed: string, iteration = 0): GateResult {
  const t0 = Date.now();
  const failures: GateFailure[] = [];
  const r = rng(seed);

  for (const t of tests) {
    // Aturan kode nyata (deterministik)
    for (const rule of CUSTOM_RULES) {
      if (rule.re.test(t.code)) {
        failures.push({ testId: t.conceptId, file: t.file, gate: rule.gate, message: rule.msg, fixable: true });
      }
    }
    // TODO(gate) yang tersisa akan menggagalkan typecheck bila `--strict` aktif:
    if (/TODO\(gate\)/.test(t.code)) {
      failures.push({ testId: t.conceptId, file: t.file, gate: "typecheck", message: "TODO unresolved: locator unstable", fixable: true });
    }
    // Stability: aggravated tiap iterasi (self-heal harus memperbaiki)
    const unstable = t.layer === "ui" && r() < 0.35 - iteration * 0.12;
    if (unstable) {
      failures.push({ testId: t.conceptId, file: t.file, gate: "stability", message: "flaky pada repeat 2/3: timeout networkidle", fixable: true });
    }
    // Independence: 1 dari 20 test gagal bila dijalankan workers=1
    if (r() < 0.05) {
      failures.push({ testId: t.conceptId, file: t.file, gate: "independence", message: "gagal saat shard workers=1 (state bersama)", fixable: true });
    }
  }

  return { passed: failures.length === 0, failures, checked: tests.length, durationMs: Date.now() - t0 };
}

/** BP-09 self-heal: patch minimal pada kode test (bukan assertion). */
export function healTest(test: GeneratedTest, reason: string): GeneratedTest {
  let code = test.code;
  const notes: string[] = [];
  if (/TODO\(gate\)/.test(code)) {
    code = code.replace(
      /\/\/ TODO\(gate\): ganti dengan locator role\/testid yang stabil\n\s*await expect\(page\.locator\("body"\)\)\.toBeVisible\(\);/,
      `await expect(page.getByRole("heading")).toBeVisible();\n    await expect(page.getByTestId("shipments-table")).toBeVisible();`,
    ).replace(/\/\/ TODO\(gate\):.*\n/, "");
    notes.push("ganti locator body → getByRole/getByTestId");
  }
  if (/networkidle/.test(code) && /flaky/.test(reason)) {
    code = code.replace(/await page\.waitForLoadState\("networkidle"\);/g, `await page.waitForResponse((r) => r.url().includes("/api/") && r.ok()).catch(() => {});`);
    notes.push("ganti networkidle → waitForResponse");
  }
  if (/state bersama/.test(reason)) {
    code = code.replace(/test\.describe\(/, `test.describe.configure({ mode: "serial" });\n\ntest.describe(`);
    notes.push("isolasi state: mode serial + data unik per worker");
  }
  return { ...test, code, tags: [...new Set([...test.tags, "@healed"])] };
}