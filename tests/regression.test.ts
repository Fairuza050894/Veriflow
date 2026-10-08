import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
process.env.VERIFLOW_DB_PATH = join(mkdtempSync(join(tmpdir(), "veriflow-regression-")), "test.db");
const db = await import("../src/lib/db.ts");

test("transactions roll back, isolate concurrent writes, support nested operations", async () => {
  const key = `test:${crypto.randomUUID()}`;
  await assert.rejects(db.tx(async () => {
    await db.kvSet(key, "rollback");
    await db.tx(async () => assert.equal(await db.kvGet(key), "rollback"));
    throw new Error("rollback");
  }), /rollback/);
  assert.equal(await db.kvGet(key), undefined);
  await Promise.all(Array.from({ length: 8 }, (_, i) => db.tx(async () => {
    await db.kvSet(`${key}:${i}`, String(i));
    assert.equal(await db.kvGet(`${key}:${i}`), String(i));
  })));
  await db.run("DELETE FROM kv WHERE key LIKE ?", [`${key}%`]);
});

test("Postgres parameter conversion preserves quoted question marks", () => {
  assert.equal(db.postgresSql("SELECT '?' AS literal, ? AS value -- ?\n/* ? */ WHERE id = ?"),
    "SELECT '?' AS literal, $1 AS value -- ?\n/* ? */ WHERE id = $2");
});

test("dashboard renders controls and filters without invalid SQL", { skip: process.env.TEST_E2E !== "1" }, async () => {
  const base = process.env.TEST_BASE_URL ?? "http://localhost:3100";
  const response = await fetch(base + "/?q=absent-" + crypto.randomUUID() + "&status=FAILED");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /name="q"/);
  assert.match(html, /name="status"/);
  assert.match(html, /SIMULASI|SIMULATION/);
  assert.doesNotMatch(html, /Clone → Analyze/);
});

const base = process.env.TEST_BASE_URL ?? "http://localhost:3100";
const enabled = process.env.TEST_E2E === "1";
async function post(path: string, body: unknown = {}) {
  return fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function finish(stream: string) {
  const res = await fetch(base + stream, { signal: AbortSignal.timeout(50000) });
  const text = await res.text();
  const match = text.match(/event: run.completed\ndata: ([^\n]+)/);
  assert.ok(match, text);
  const result = JSON.parse(match[1]);
  assert.ok(["COMPLETED", "COMPLETED_WITH_WARNINGS"].includes(result.status), text);
  assert.ok(result.summary.total > 0, text);
}

test("concurrent retry creates one run; report token required; persisted URL works", { skip: !enabled, timeout: 60000 }, async () => {
  const body = { repo_url: `https://github.com/regression/repo-${crypto.randomUUID()}`, idempotency_key: crypto.randomUUID() };
  const responses = await Promise.all([post("/api/v1/projects/quick-run", body), post("/api/v1/projects/quick-run", body)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 202]);
  const [a, b] = await Promise.all(responses.map((r) => r.json()));
  assert.equal(a.run_id, b.run_id);
  assert.equal(a.environment_id, b.environment_id);
  assert.equal(a.report, b.report);
  await finish(a.stream);
  const history = await (await fetch(`${base}/api/v1/projects/${a.project_id}/runs`)).json();
  assert.ok(Array.isArray(history.runs));
  assert.equal(history.total, 1);
  assert.equal(new URL(history.runs[0].report_url).pathname, a.report);
  assert.equal((await fetch(base + a.report)).status, 200);
  assert.equal((await fetch(`${base}/r/${a.run_id}`)).status, 404);
  assert.equal((await fetch(`${base}/r/${"0".repeat(64)}`)).status, 404);
  assert.equal((await post(`/api/v1/projects/${a.project_id}/runs`, null)).status, 422);
  assert.equal((await post(`/api/v1/projects/${a.project_id}/runs`, { environment_id: "missing" })).status, 422);
  const report = await fetch(base + a.report);
  assert.equal(report.headers.get("referrer-policy"), "no-referrer");
  assert.equal(report.headers.get("x-robots-tag"), "noindex");
  if (process.env.TEST_DATABASE_URL) {
    const email = await db.one<{ body_html: string }>("SELECT body_html FROM email_messages WHERE run_id = ? AND kind = 'report' LIMIT 1", [a.run_id]);
    assert.ok(email?.body_html.includes(a.report), "email must contain the valid report token");
    const recipients = await db.one<{ n: number }>("SELECT COUNT(*) n FROM recipients WHERE project_id = ?", [a.project_id]);
    assert.equal(recipients?.n, 1);
    await db.run("UPDATE report_links SET revoked_at = ? WHERE run_id = ?", [db.nowIso(), a.run_id]);
    assert.equal((await fetch(base + a.report)).status, 404);
    await db.run("UPDATE report_links SET revoked_at = NULL, expires_at = ? WHERE run_id = ?", ["2000-01-01T00:00:00.000Z", a.run_id]);
    assert.equal((await fetch(base + a.report)).status, 404);
  }
  const fresh = await post("/api/v1/projects/quick-run", { repo_url: body.repo_url });
  assert.equal(fresh.status, 202);
  const c = await fresh.json();
  assert.notEqual(c.run_id, a.run_id);
  await finish(c.stream);
});

test("review approval resumes pipeline; second approval rejected", { skip: !enabled, timeout: 60000 }, async () => {
  const res = await post("/api/v1/projects/quick-run", {
    repo_url: `https://github.com/regression/review-${crypto.randomUUID()}`, mode: "REVIEW_GATE",
  });
  assert.equal(res.status, 202);
  const run = await res.json();
  // Read SSE until the approval gate, then cancel the connection.
  const stream = await fetch(base + run.stream, { signal: AbortSignal.timeout(20000) });
  const reader = stream.body!.getReader();
  let events = "";
  while (!events.includes('"status":"WAITING_APPROVAL"')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false, events);
    events += new TextDecoder().decode(chunk.value);
  }
  await reader.cancel();
  const approved = await post(`/api/v1/runs/${run.run_id}/approve`);
  assert.equal(approved.status, 200, await approved.clone().text());
  assert.ok(["COMPLETED", "COMPLETED_WITH_WARNINGS"].includes((await approved.json()).status));
  assert.equal((await post(`/api/v1/runs/${run.run_id}/approve`)).status, 409);
});

test("rejected review stays cancelled on subsequent advances", { skip: !enabled, timeout: 60000 }, async () => {
  const res = await post("/api/v1/projects/quick-run", {
    repo_url: `https://github.com/regression/reject-${crypto.randomUUID()}`, mode: "REVIEW_GATE",
  });
  assert.equal(res.status, 202);
  const run = await res.json();
  const stream = await fetch(base + run.stream, { signal: AbortSignal.timeout(20000) });
  const reader = stream.body!.getReader();
  let events = "";
  while (!events.includes('"status":"WAITING_APPROVAL"')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false, events);
    events += new TextDecoder().decode(chunk.value);
  }
  await reader.cancel();
  const rejected = await post(`/api/v1/runs/${run.run_id}/reject`);
  assert.equal(rejected.status, 200);
  assert.equal((await rejected.json()).status, "CANCELLED");
  const after = await (await fetch(base + run.stream, { signal: AbortSignal.timeout(20000) })).text();
  assert.match(after, /event: run.completed\ndata: .*"status":"CANCELLED"/);
  assert.equal((await post(`/api/v1/runs/${run.run_id}/approve`)).status, 409);
});
