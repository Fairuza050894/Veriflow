import { ArchModelSchema, type ArchModel } from "../contracts";
import { uid, sha256 } from "../db";
import { lineOf } from "../util";
import type { Workspace } from "../workspace";
import { parseOpenapi as parseOpenapiRaw } from "../pipeline/analyze";

/** Parser OpenAPI milik analyzer — dibungkus objek agar impor tetap statis. */
const openapiParser = { parseOpenapi: parseOpenapiRaw };

type N = ArchModel["nodes"][number];
type E = ArchModel["edges"][number];
type Ext = {
  name: string; version: string;
  detect(ws: Workspace): boolean;
  extract(ws: Workspace, ctx: Ctx): { nodes: N[]; edges: E[]; findings: ArchModel["findings"] };
};
type Ctx = { commit: string; snapshotId: string };

const SENSITIVE = /(password|secret|token|apikey|api_key|ssn|credential|billing_?token)/i;

/** "Extract first, draw second" (§18.1): LLM tidak pernah jadi sumber edge. */
const extractors = (): Ext[] => [prismaExt, openapiExt, routeExt, composeExt, ciExt, depsExt];

export function extractArchitecture(ws: Workspace, snapshotId = uid("arch_")): ArchModel {
  const ctx: Ctx = { commit: ws.commit, snapshotId };
  const nodes: N[] = [];
  const edges: E[] = [];
  const findings: ArchModel["findings"] = [];
  const status: ArchModel["extractors"] = [];

  for (const ext of extractors()) {
    let detected = false;
    try {
      detected = ext.detect(ws);
      if (!detected) { status.push({ name: ext.name, version: ext.version, status: "skipped" }); continue; }
      const out = ext.extract(ws, ctx);
      nodes.push(...out.nodes);
      edges.push(...out.edges);
      findings.push(...out.findings);
      status.push({ name: ext.name, version: ext.version, status: "ok" });
    } catch (e) {
      // Kegagalan satu extractor TIDAK boleh menggagalkan yang lain (§18.4).
      status.push({ name: ext.name, version: ext.version, status: "failed", reason: (e as Error).message.slice(0, 160) });
    }
  }

  // Public endpoint tanpa auth = temuan aturan deterministik (§18.11)
  for (const n of nodes) {
    if (n.kind === "endpoint" && n.attrs?.auth === "none" && !n.internal_only) {
      findings.push({
        id: `F-${sha256(n.id).slice(0, 4).toUpperCase()}`,
        type: "public_endpoint_no_auth",
        severity: "high",
        nodes: [n.id],
        detail: `${n.label} dapat diakses tanpa autentikasi`,
        evidence: n.evidence,
      });
    }
  }

  // Deteksi siklus modul sederhana (DFS) -> F-cycle
  const cycles = findCycles(edges.filter((e) => e.kind === "imports"));
  for (const [i, cyc] of cycles.slice(0, 5).entries()) {
    findings.push({
      id: `F-CYC-${i + 1}`, type: "cycle", severity: "medium",
      nodes: cyc, detail: `Siklus dependensi: ${cyc.join(" → ")} → ${cyc[0]}`, evidence: [],
    });
  }

  const clean = dedupe(nodes);
  const ids = new Set(clean.map((n) => n.id));

  // Buang edge yang menunjuk node tak dikenal (mis. svc:api tanpa docker-compose).
  return ArchModelSchema.parse({
    schema_version: "1.0",
    snapshot_id: snapshotId,
    repo: { commit: ws.commit, subfolder: "." },
    extractors: status,
    nodes: clean,
    edges: dedupe(edges).filter((e) => ids.has(e.from) && ids.has(e.to)),
    findings,
  });
}

function dedupe<T extends { id?: string; from?: string; to?: string; kind?: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = x.id ? `n:${x.id}` : `e:${x.from}>${x.to}:${x.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function findCycles(edges: E[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const dfs = (n: string) => {
    state.set(n, 1); stack.push(n);
    for (const m of adj.get(n) ?? []) {
      if (state.get(m) === 1) {
        const i = stack.indexOf(m);
        if (i >= 0) cycles.push([...stack.slice(i), m]);
      } else if (state.get(m) === undefined) dfs(m);
    }
    stack.pop(); state.set(n, 2);
  };
  for (const n of adj.keys()) if (state.get(n) === undefined) dfs(n);
  return cycles;
}

// ────────────────────────── Prisma → tabel & kolom ──────────────────────────
const prismaExt: Ext = {
  name: "prisma",
  version: "0.4.1",
  detect: (ws) => Object.keys(ws.files).some((f) => /prisma\/schema\.prisma$/.test(f)),
  extract(ws) {
    const file = Object.keys(ws.files).find((f) => /prisma\/schema\.prisma$/.test(f))!;
    const src = ws.files[file];
    const nodes: N[] = [], edges: E[] = [], findings: ArchModel["findings"] = [];

    const dbNode: N = {
      id: "db:postgres", kind: "database", label: "PostgreSQL", tech: "postgres",
      group: "data", evidence: [{ file, line: lineOf(src, "provider =") }],
      confidence: "extracted", sensitive: false, internal_only: false, attrs: {},
    };
    nodes.push(dbNode);

    const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
    for (const m of src.matchAll(modelRe)) {
      const name = m[1];
      const body = m[2];
      const columns: NonNullable<N["columns"]> = [];
      const rels: Array<{ field: string; target: string; key: string }> = [];

      for (const raw of body.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("//")) continue;
        const rel = line.match(/^(\w+)\s+(\w+)(\[\])?\s+@relation\((.*)\)/);
        if (rel) {
          rels.push({ field: rel[1], target: rel[2], key: `fields: [${rel[4].match(/fields:\s*\[([^\]]+)\]/)?.[1] ?? rel[1]}]` });
          continue;
        }
        const fkRel = line.match(/^(\w+)\s+(\w+)\?*\s+@relation/);
        const f = line.match(/^(\w+)\s+([\w()\s]+?)\s*(\?)?\s*(@|$)/);
        if (!f) continue;
        const fieldName = f[1];
        const type = f[2].trim().split(/\s+/)[0];
        const isRel = ["String", "Int", "Float", "Boolean", "DateTime", "Decimal"].indexOf(type) < 0;
        columns.push({
          name: fieldName,
          type,
          pk: /@id/.test(line),
          fk: /@relation/.test(line) && rels.some((r) => r.field === fieldName) ? `db:${type}` : undefined,
          sensitive: SENSITIVE.test(fieldName) || SENSITIVE.test(line),
        });
        void fkRel;
      }

      nodes.push({
        id: `db:${name}`, kind: "table", label: name, group: `domain:${name}`,
        columns, evidence: [{ file, line: lineOf(src, `model ${name}`) }],
        confidence: "extracted", sensitive: false, internal_only: false, attrs: { relations: rels.length },
      });
      edges.push({ from: `db:${name}`, to: "db:postgres", kind: "lives_in", confidence: "extracted", evidence: [{ file }] });
      for (const r of rels) edges.push({ from: `db:${name}`, to: `db:${r.target}`, kind: "references", confidence: "extracted", evidence: [{ file }] });
    }

    // Tabel tanpa FK ke tabel lain = temuan (FR-DGM-18 "tabel tanpa FK")
    const hasFk = new Set(edges.filter((e) => e.kind === "references").map((e) => e.from));
    for (const n of nodes.filter((x) => x.kind === "table")) {
      if (!hasFk.has(n.id)) {
        findings.push({
          id: `F-NOFK-${n.label}`, type: "table_without_fk", severity: "low",
          nodes: [n.id], detail: `Tabel ${n.label} tidak punya relasi FK — cek konsistensi integritas data`, evidence: n.evidence,
        });
      }
    }
    return { nodes, edges, findings };
  },
};

// ────────────────────────── OpenAPI → endpoint ──────────────────────────
const openapiExt: Ext = {
  name: "openapi",
  version: "0.3.0",
  detect: (ws) => Object.keys(ws.files).some((f) => /(openapi|swagger)\.(ya?ml|json)$/i.test(f)),
  extract(ws) {
    const file = Object.keys(ws.files).find((f) => /(openapi|swagger)\.(ya?ml|json)$/i.test(f))!;
    const src = ws.files[file];
    const nodes: N[] = [], edges: E[] = [];
    // reuse parser analyzer (satu sumber kebenaran)
    const { parseOpenapi } = openapiParser;
    for (const ep of parseOpenapi(src)) {
      const id = `api:${ep.method} ${ep.path}`;
      nodes.push({
        id, kind: "endpoint", label: `${ep.method} ${ep.path}`, group: groupOfResource(ep.path),
        evidence: [{ file, line: lineOf(src, `/${ep.path.replace(/^\//, "")}:`) }],
        confidence: "extracted", sensitive: false, internal_only: false,
        attrs: { auth: ep.auth, method: ep.method, path: ep.path },
      });
    }
    return { nodes, edges: edgesOf(nodes, "exposes"), findings: [] };
  },
};

function groupOfResource(path: string): string {
  const seg = path.replace(/^\/api\/?/, "").split(/[/?]/)[0] ?? "root";
  return `api:${seg || "root"}`;
}

const edgesOf = (nodes: N[], kind: string): E[] =>
  nodes.map((n) => ({ from: "svc:api", to: n.id, kind, confidence: "extracted" as const, evidence: n.evidence }));

// ────────────────────────── Route handler / UI pages ──────────────────────────
const routeExt: Ext = {
  name: "routes",
  version: "0.3.1",
  detect: (ws) => Object.keys(ws.files).some((f) => /\/route\.[tj]s$|\/page\.[tj]sx?$/.test(f)),
  extract(ws) {
    const nodes: N[] = [], edges: E[] = [];
    for (const [file, content] of Object.entries(ws.files)) {
      const page = file.match(/^src\/app\/(.*)\/page\.[tj]sx?$/);
      if (page) {
        const p = "/" + page[1].replace(/\/\([^/]+\)/g, "").replace(/\/index$/, "").replace(/\/\[([^\]]+)\]/g, "/:$1").replace(/\/$/, "") || "/";
        const node: N = {
          id: `route:${p}`, kind: "route", label: p, tech: "next-app-router",
          group: "ui", evidence: [{ file, line: 1 }], confidence: "extracted",
          sensitive: false, internal_only: false,
          attrs: { hasTestId: /data-testid=/.test(content), auth: !/^\/(login|signin)/.test(p) },
        };
        nodes.push(node);
        edges.push({ from: "svc:web", to: node.id, kind: "serves", confidence: "extracted", evidence: [{ file }] });
        continue;
      }
      if (/\/route\.[tj]s$/.test(file)) {
        const p = "/" + file.replace(/^src\/app\//, "").replace(/\/route\.[tj]s$/, "").replace(/\/\[[^\]]+\]/g, "/:param").replace(/\/$/, "");
        for (const m of content.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)/g)) {
          const id = `api:${m[1]} ${p}`;
          if (nodes.some((n) => n.id === id)) continue;
          const node: N = {
            id, kind: "endpoint", label: `${m[1]} ${p}`, group: groupOfResource(p),
            evidence: [{ file, line: lineOf(content, `function ${m[1]}`) }],
            confidence: "extracted", sensitive: false, internal_only: false,
            attrs: { auth: /requireAuth|verifyToken|AuthGuard/.test(content) ? "bearer" : "none", method: m[1], path: p },
          };
          nodes.push(node);
          edges.push({ from: "svc:web", to: node.id, kind: "exposes", confidence: "extracted", evidence: [{ file }] });
        }
      }
    }
    return { nodes, edges, findings: [] };
  },
};

// ────────────────────────── docker-compose / Dockerfile → container ──────────────────────────
const composeExt: Ext = {
  name: "compose",
  version: "0.2.4",
  detect: (ws) => Object.keys(ws.files).some((f) => /docker-compose|compose\.ya?ml|Dockerfile/.test(f)),
  extract(ws) {
    const nodes: N[] = [], edges: E[] = [], findings: ArchModel["findings"] = [];
    const composeFile = Object.keys(ws.files).find((f) => /docker-compose|compose\.ya?ml/.test(f));
    if (composeFile) {
      const src = ws.files[composeFile];
      const services = src.match(/^\s{2}(\w[\w-]*):\s*$/gm)?.map((m) => m.trim().replace(":", "")) ?? [];
      for (const svc of services) {
        if (["volumes", "networks", "services"].includes(svc)) continue;
        const line = lineOf(src, `  ${svc}:`) ?? 1;
        const isDb = /postgres|mysql|mongo|redis|elasticsearch/.test(svc);
        nodes.push({
          id: `svc:${svc}`, kind: isDb ? "database" : "service", label: svc,
          tech: /postgres/.test(svc) ? "postgres" : isDb ? "cache" : "container",
          group: "runtime", evidence: [{ file: composeFile, line }],
          confidence: "extracted", sensitive: false, internal_only: false,
          attrs: { service: svc },
        });
        const depends = src.split(new RegExp(`\\n  ${svc}:`))[1]?.match(/depends_on:\s*\[([^\]]+)\]/)?.[1];
        for (const d of (depends ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
          edges.push({ from: `svc:${svc}`, to: `svc:${d}`, kind: "depends_on", confidence: "extracted", evidence: [{ file: composeFile, line }] });
        }
      }
      if (src.includes(":latest")) {
        findings.push({ id: "F-COMPOSE-LATEST", type: "supply_chain", severity: "medium", nodes: [], detail: 'Gunakan tag image eksplisit, bukan ":latest"', evidence: [{ file: composeFile }] });
      }
    }
    // Dockerfile audit (hadolint-lite §18.10)
    for (const [file, content] of Object.entries(ws.files)) {
      if (!/Dockerfile$/.test(file)) continue;
      if (!/USER\s+\w/.test(content) && !/USER\s+node/.test(content)) {
        findings.push({ id: `F-DOCKER-USER-${file.replace(/\W/g, "_")}`, type: "dockerfile", severity: "high", nodes: [], detail: "Dockerfile tidak menetapkan USER non-root (DL3002)", evidence: [{ file }] });
      }
      if (/FROM\s+\S+:latest/.test(content)) {
        findings.push({ id: `F-DOCKER-LATEST-${file.replace(/\W/g, "_")}`, type: "dockerfile", severity: "low", nodes: [], detail: 'Base image memakai tag ":latest" (DL3007)', evidence: [{ file }] });
      }
    }
    return { nodes, edges, findings };
  },
};

// ────────────────────────── CI pipeline (D07) ──────────────────────────
const ciExt: Ext = {
  name: "ci",
  version: "0.2.0",
  detect: (ws) => Object.keys(ws.files).some((f) => /\.github\/workflows\/.*\.ya?ml$|\.gitlab-ci\.yml$|Jenkinsfile$/.test(f)),
  extract(ws) {
    const nodes: N[] = [], edges: E[] = [];
    const wf = Object.keys(ws.files).find((f) => /\.github\/workflows\/.*\.ya?ml$/.test(f));
    if (!wf) return { nodes, edges, findings: [] };
    const src = ws.files[wf];
    const trigger = src.match(/on:\s*\n?\s*(push|pull_request|schedule)/)?.[1] ?? "push";
    const nodes_ = [`ci:trigger:${trigger}`];
    nodes.push({
      id: `ci:trigger:${trigger}`, kind: "pipeline_stage", label: trigger === "push" ? "push / PR" : trigger,
      group: "ci", evidence: [{ file: wf, line: lineOf(src, "on:") ?? 1 }],
      confidence: "extracted", sensitive: false, internal_only: false, attrs: { trigger },
    });
    let prev = `ci:trigger:${trigger}`;
    const hasTest = /run:\s*(npm test|jest|playwright|npx playwright)/.test(src);
    for (const m of src.matchAll(/^  ([a-z][\w-]*):\s*$/gm)) {
      const job = m[1];
      if (["on", "jobs", "env", "permissions", "name"].includes(job)) continue;
      const id = `ci:job:${job}`;
      nodes.push({
        id, kind: "pipeline_stage", label: job, group: "ci",
        evidence: [{ file: wf, line: lineOf(src, `  ${job}:`) ?? 1 }],
        confidence: "extracted", sensitive: false, internal_only: false,
        attrs: { job, needs: src.match(new RegExp(`${job}:[\\s\\S]{0,120}?needs:\\s*([\\w,\\s]+)`))?.[1]?.trim().split(/\s*,\s*/) ?? [] },
      });
      edges.push({ from: prev, to: id, kind: "then", confidence: "extracted", evidence: [{ file: wf }] });
      prev = id;
      nodes_.push(job);
    }
    const findings: ArchModel["findings"] = [];
    if (!hasTest) {
      findings.push({
        id: "F-CI-NOTEST", type: "ci_no_tests", severity: "high", nodes: [],
        detail: "Pipeline CI tidak menjalankan test apa pun sebelum deploy", evidence: [{ file: wf }],
      });
    }
    if (hasTest && !/playwright/.test(src)) {
      findings.push({
        id: "F-CI-NOE2E", type: "ci_no_e2e", severity: "medium", nodes: [],
        detail: "Tidak ada smoke/E2E gate sebelum deploy produksi", evidence: [{ file: wf }],
      });
    }
    return { nodes, edges, findings };
  },
};

// ────────────────────────── Import graph modul (D03) ──────────────────────────
const depsExt: Ext = {
  name: "deps",
  version: "0.1.3",
  detect: (ws) => Object.keys(ws.files).some((f) => /^src\/.*\.[tj]sx?$/.test(f)),
  extract(ws) {
    const files = Object.keys(ws.files).filter((f) => /^src\/.*\.[tj]sx?$/.test(f));
    const nodes: N[] = [], edges: E[] = [];
    const mods = new Map<string, string>();
    for (const f of files) mods.set(f, modId(f));
    for (const f of files) {
      const id = mods.get(f)!;
      nodes.push({
        id, kind: "module", label: modLabel(f), group: groupOfModule(f),
        evidence: [{ file: f, line: 1 }], confidence: "extracted",
        sensitive: false, internal_only: false, attrs: { file: f },
      });
      for (const m of ws.files[f].matchAll(/from\s+["'](@\/[^"']+|\.{1,2}\/[^"']+)["']/g)) {
        const spec = m[1];
        const target = resolveAlias(spec, f);
        const tid = mods.get(target);
        if (tid && tid !== id) {
          edges.push({ from: id, to: tid, kind: "imports", confidence: "extracted", evidence: [{ file: f, line: lineOf(ws.files[f], spec) }] });
        }
      }
    }
    return { nodes, edges, findings: [] };
  },
};

const modId = (f: string) => `mod:${f.replace(/^src\//, "").replace(/\.[tj]sx?$/, "")}`;
const modLabel = (f: string) => f.replace(/^src\//, "").replace(/\.[tj]sx?$/, "");
function groupOfModule(f: string): string {
  const seg = f.replace(/^src\//, "").split("/")[0];
  return `group:${seg || "root"}`;
}
function resolveAlias(spec: string, fromFile: string): string {
  if (spec.startsWith("@/")) return `src/${spec.slice(2)}`;
  const dir = fromFile.split("/").slice(0, -1).join("/");
  const segs = (dir ? dir.split("/") : []).concat(spec.split("/"));
  const out: string[] = [];
  for (const s of segs) {
    if (s === "." || s === "") continue;
    if (s === "..") { out.pop(); continue; }
    out.push(s);
  }
  return out.join("/");
}