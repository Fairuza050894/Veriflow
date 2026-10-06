import type { ArchModel, CoverageEntry } from "../contracts";
import type { Audience, DiagramKind } from "../types";
import { clamp } from "../util";

const MAX_NODES = 150; // FR-DGM-12

type Palette = { ok: string; bad: string; flaky: string; gap: string; line: string; text: string; sub: string };

/** Tema terang untuk email/PDF (latar putih) — §18.7. */
const LIGHT: Palette = {
  ok: "#1C7A4B", bad: "#B3261E", flaky: "#9A6200", gap: "#6b7280",
  line: "#94a3b8", text: "#0f172a", sub: "#475569",
};

export type DiagramInput = {
  model: ArchModel;
  coverage: Record<string, CoverageEntry>;
  audience: Audience;
  locale: "id" | "en";
};

/** Redaksi SEBELUM render (§18.1.5). Untuk audiens non-internal: sembunyikan DB detail & host internal. */
export function redact(model: ArchModel, audience: Audience): ArchModel {
  if (audience === "internal") return model;
  const nodes = model.nodes.map((n) => {
    if (audience !== "customer" && audience !== "public") return n;
    // customer/public: DB = satu kotak, tanpa kolom/tabel/relasi (FR-DGM-24, §18.8b)
    if (n.kind === "table") {
      return { ...n, internal_only: true, columns: undefined, attrs: { ...n.attrs, redacted: true } };
    }
    if (n.internal_only || n.sensitive) {
      return { ...n, label: aliasLabel(n.label), columns: undefined, internal_only: true, attrs: { ...n.attrs, aliased: true } };
    }
    return n;
  });
  const visible = new Set(nodes.filter((n) => !n.internal_only || n.kind === "database" || n.kind === "service").map((n) => n.id));
  return {
    ...model,
    nodes,
    edges: model.edges.filter((e) => visible.has(e.from) && visible.has(e.to)),
    findings: audience === "customer" || audience === "public"
      ? model.findings.filter((f) => f.type !== "public_endpoint_no_auth" && f.type !== "table_without_fk")
      : model.findings,
  };
}

function aliasLabel(label: string): string {
  return label
    .replace(/\.internal\b/g, "")
    .replace(/\b(db|gw|cache|redis|internal|int)\b/gi, "service")
    .replace(/\d+\.\d+\.\d+\.\d+/g, "10.x.x.x");
}

const esc = (s: string) => s.replace(/["<>]/g, (c) => ({ '"': "#quot;", "<": "#lt;", ">": "#gt;" }[c]!));
const covBadge = (c: CoverageEntry | undefined, locale: "id" | "en") => {
  if (!c || c.tests === 0) return locale === "id" ? "0 test" : "0 tests";
  const mark = c.state === "flaky" ? "~" : c.state === "failed" ? "✖" : "✔";
  return `${mark} ${c.passed}/${c.tests}`;
};
const covClass = (c: CoverageEntry | undefined) => {
  if (!c || c.tests === 0) return "gap";
  if (c.state === "failed") return "bad";
  if (c.state === "flaky") return "flaky";
  return "ok";
};

function selectNodes<T extends { id: string }>(all: T[], scored: Map<string, number>, max = MAX_NODES) {
  if (all.length <= max) return { nodes: all, truncated: false };
  return {
    nodes: [...all].sort((a, b) => (scored.get(b.id) ?? 0) - (scored.get(a.id) ?? 0)).slice(0, max),
    truncated: true,
  };
}

function centrality(model: ArchModel) {
  const deg = new Map<string, number>();
  for (const e of model.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  return deg;
}

function header(title: string, p: Palette) {
  return `%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#f8fafc", "lineColor": "${p.line}", "fontSize": "15px"}, "flowchart": {"curve": "basis", "padding": 18}}}%%\n%% Veriflow — ${title}\n`;
}

function classDefs(p: Palette) {
  return [
    `  classDef ok stroke:${p.ok},stroke-width:2px,color:${p.text}`,
    `  classDef bad stroke:${p.bad},stroke-width:3px,color:${p.text}`,
    `  classDef gap stroke:${p.gap},stroke-dasharray:5 4,color:${p.gap}`,
    `  classDef flaky stroke:${p.flaky},stroke-dasharray:2 3 8 3,color:${p.flaky}`,
  ].join("\n");
}

const nid = (id: string) => "n" + Math.abs(hash(id)).toString(36);
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h;
}

function legend(p: Palette, locale: "id" | "en") {
  const items = locale === "id"
    ? ["Lulus semua", "Ada gagal", "Flaky", "Tanpa test"]
    : ["All passed", "Has failures", "Flaky", "Untested"];
  return `  subgraph legend["Legenda · ${items[0]} · ${items[1]} · ${items[2]} · ${items[3]}"]\n    direction LR\n    L1["✔ semua lulus"]\n    L2["✖ ada gagal"]\n    L3["~ flaky"]\n    L4["0 test"]\n  end\n  style legend fill:none,stroke:${p.gap},stroke-dasharray:2 2`;
}

// ───────────────────────────── D01 + D09: container/system + overlay ─────────────────────────────
export function composeSystem(input: DiagramInput) {
  const p = LIGHT;
  const { model, coverage, locale } = input;
  const deg = centrality(model);
  const scored = new Map<string, number>();
  for (const n of model.nodes) {
    const c = coverage[n.id];
    scored.set(n.id, (c?.failed ?? 0) * 10 + (c?.tests === 0 ? 5 : 0) + (deg.get(n.id) ?? 0));
  }
  const kinds = new Set(["service", "database", "external", "table"]);
  const pool = model.nodes.filter((n) => kinds.has(n.kind) && (n.kind !== "table" || input.audience === "internal"));
  const { nodes, truncated } = selectNodes(pool, scored, 40);

  const lines: string[] = [header("System context & container", p), "flowchart LR"];
  for (const n of nodes) {
    const c = coverage[n.id];
    const label = `${esc(n.label)}${n.tech ? `<br/>${esc(n.tech)}` : ""}<br/>${covBadge(c, locale)}`;
    const shape = n.kind === "database" ? `[("${esc(n.label)}<br/>${covBadge(c, locale)}")]`
      : n.kind === "external" ? `{{"${esc(n.label)}<br/>${covBadge(c, locale)}"}}`
      : `["${label}"]`;
    lines.push(`  ${nid(n.id)}${shape}:::${covClass(c)}`);
  }
  for (const e of model.edges) {
    if (!nodes.some((n) => n.id === e.from) || !nodes.some((n) => n.id === e.to)) continue;
    if (!["depends_on", "lives_in", "references", "http", "reads_writes"].includes(e.kind)) continue;
    const arrow = e.confidence === "inferred" ? "-.->" : e.confidence === "observed" ? "-->" : "-->";
    const lbl = e.kind === "lives_in" ? "" : e.kind === "references" ? "fk" : e.kind === "depends_on" ? "dep" : "";
    lines.push(`  ${nid(e.from)} ${arrow}${lbl ? `|${lbl}|` : ""} ${nid(e.to)}`);
  }
  lines.push(classDefs(p), legend(p, locale));
  if (truncated) lines.push(`  note["Ringkas ke ${MAX_NODES} node berdasarkan sentralitas & kegagalan"]`);
  return { source: lines.join("\n"), nodeCount: nodes.length, truncated };
}

// ───────────────────────────── D02: ERD ─────────────────────────────
export function composeErd(input: DiagramInput) {
  const p = LIGHT;
  const { model, coverage } = input;
  if (input.audience !== "internal") {
    return {
      source: `%% ERD hanya untuk audiens internal (FR-DGM-24)\nflowchart LR\n  db[("Database")]\n  classDef gap stroke:${p.gap},stroke-dasharray:5 4`,
      nodeCount: 0,
      truncated: false,
    };
  }
  const deg = centrality(model);
  const scored = new Map<string, number>();
  for (const n of model.nodes) scored.set(n.id, (coverage[n.id]?.failed ?? 0) * 5 + (deg.get(n.id) ?? 0));
  const tables = model.nodes.filter((n) => n.kind === "table");
  const { nodes, truncated } = selectNodes(tables, scored, 40);

  const lines: string[] = [header("Entity relationship diagram", p), "erDiagram"];
  const cols = (n: (typeof nodes)[number]) =>
    (n.columns ?? []).filter((c) => !c.sensitive).slice(0, 8)
      .map((c) => `${c.type} ${c.name}${c.pk ? " PK" : ""}`).join(", ") || "id uuid";
  for (const n of nodes) lines.push(`  ${n.label.toUpperCase().replace(/\W/g, "_")} { ${cols(n)} }`);
  for (const e of model.edges) {
    if (e.kind !== "references") continue;
    const a = nodes.find((n) => n.id === e.from), b = nodes.find((n) => n.id === e.to);
    if (!a || !b) continue;
    const many = (a.attrs?.relations as number) ?? 1;
    lines.push(`  ${a.label.toUpperCase().replace(/\W/g, "_")} ||--|{ ${b.label.toUpperCase().replace(/\W/g, "_")} : "has"` + (many > 1 ? " many" : "") + `"`);
  }
  if (truncated) lines.push("  note_erd { string note \"ERD dipangkas\" }");
  return { source: lines.join("\n"), nodeCount: nodes.length, truncated };
}

// ───────────────────────────── D04: peta API ─────────────────────────────
export function composeApiMap(input: DiagramInput) {
  const p = LIGHT;
  const { model, coverage, locale } = input;
  const scored = new Map<string, number>();
  for (const n of model.nodes) scored.set(n.id, (coverage[n.id]?.failed ?? 0) * 5 + (n.attrs?.auth === "none" ? 3 : 0));
  const eps = selectNodes(model.nodes.filter((n) => n.kind === "endpoint"), scored, 60);
  const lines: string[] = [header("API map", p), "flowchart TB"];
  const groups = new Map<string, typeof eps.nodes>();
  for (const n of eps.nodes) {
    const g = String(n.group ?? "api:other");
    groups.set(g, [...(groups.get(g) ?? []), n]);
  }
  for (const [g, list] of groups) {
    const gid = "g" + Math.abs(hash(g)).toString(36);
    lines.push(`  subgraph ${gid}["${esc(g.replace("api:", "resource: "))}"]`);
    for (const n of list) {
      const c = coverage[n.id];
      const auth = n.attrs?.auth === "none" ? " 🔓" : "";
      lines.push(`    ${nid(n.id)}["${esc(n.label)}${auth}<br/>${covBadge(c, locale)}"]:::${covClass(c)}`);
    }
    lines.push(`  end`);
  }
  lines.push(classDefs(p));
  return { source: lines.join("\n"), nodeCount: eps.nodes.length, truncated: eps.truncated };
}

// ───────────────────────────── D05: peta halaman UI ─────────────────────────────
export function composeUiMap(input: DiagramInput) {
  const p = LIGHT;
  const { model, coverage, locale } = input;
  const routes = model.nodes.filter((n) => n.kind === "route");
  const scored = new Map<string, number>();
  for (const n of routes) scored.set(n.id, coverage[n.id]?.tests === 0 ? 5 : (deg0(n.id)));
  const sel = selectNodes(routes, scored, 40);
  const lines: string[] = [header("UI pages & journeys", p), "flowchart TD"];
  for (const n of sel.nodes) {
    const c = coverage[n.id];
    const auth = n.attrs?.auth ? " 🔒" : "";
    const tid = n.attrs?.hasTestId ? " ·testid" : " ·no-testid";
    lines.push(`  ${nid(n.id)}["${esc(n.label)}${auth}${tid}<br/>${covBadge(c, locale)}"]:::${covClass(c)}`);
  }
  // urutan router sederhana: login -> dashboard -> child
  const order = ["/login", "/", "/shipments", "/drivers"];
  const seq = order.filter((p2) => sel.nodes.some((n) => n.label === p2));
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = sel.nodes.find((n) => n.label === seq[i])!, b = sel.nodes.find((n) => n.label === seq[i + 1])!;
    lines.push(`  ${nid(a.id)} --> ${nid(b.id)}`);
  }
  lines.push(classDefs(p));
  return { source: lines.join("\n"), nodeCount: sel.nodes.length, truncated: sel.truncated };
}

const deg0 = (s: string) => Math.abs(hash(s) % 7);

// ───────────────────────────── D07: pipeline CI/CD ─────────────────────────────
export function composePipeline(input: DiagramInput) {
  const p = LIGHT;
  const { model, locale } = input;
  const stages = model.nodes.filter((n) => n.kind === "pipeline_stage");
  const lines: string[] = [header("CI/CD pipeline", p), "flowchart LR"];
  for (const n of stages) {
    const hasTest = /test|e2e|smoke/i.test(n.label);
    lines.push(`  ${nid(n.id)}{"${esc(n.label)}"}:::${hasTest ? "ok" : "gap"}`);
  }
  for (const e of model.edges) {
    if (e.kind !== "then") continue;
    lines.push(`  ${nid(e.from)} --> ${nid(e.to)}`);
  }
  const noGate = model.findings.some((f) => f.type === "ci_no_e2e" || f.type === "ci_no_tests");
  lines.push(classDefs(p));
  lines.push(`  note${noGate ? '["Tidak ada gate smoke/E2E sebelum deploy produksi"]' : '["Gate test terpasang"]'}`);
  void locale;
  return { source: lines.join("\n"), nodeCount: stages.length, truncated: false };
}

// ───────────────────────────── D08: topologi infra ─────────────────────────────
export function composeInfra(input: DiagramInput) {
  const p = LIGHT;
  const { model } = input;
  const infra = model.nodes.filter((n) => n.kind === "service" || n.kind === "database");
  const lines: string[] = [header("Deploy topology", p), "flowchart TB"];
  for (const n of infra) lines.push(`  ${nid(n.id)}["${esc(n.label)}${n.tech ? `<br/>${esc(n.tech)}` : ""}"]`);
  for (const e of model.edges) {
    if (e.kind === "depends_on") lines.push(`  ${nid(e.from)} --> ${nid(e.to)}`);
  }
  const cloud = model.nodes.filter((n) => n.kind === "cloud_resource");
  for (const n of cloud) lines.push(`  ${nid(n.id)}[("${esc(n.label)}")]`);
  lines.push(classDefs(p));
  return { source: lines.join("\n"), nodeCount: infra.length + cloud.length, truncated: false };
}

// ───────────────────────────── D03: dependensi modul ─────────────────────────────
export function composeModules(input: DiagramInput) {
  const p = LIGHT;
  const { model, coverage } = input;
  const deg = centrality(model);
  const scored = new Map<string, number>();
  for (const n of model.nodes) if (n.kind === "module") scored.set(n.id, (deg.get(n.id) ?? 0) + (coverage[n.id]?.failed ?? 0) * 5);
  const mods = selectNodes(model.nodes.filter((n) => n.kind === "module"), scored, 60);
  const lines: string[] = [header("Module dependency graph", p), "flowchart LR"];
  const inSet = new Set(mods.nodes.map((n) => n.id));
  for (const n of mods.nodes) {
    const c = coverage[n.id];
    lines.push(`  ${nid(n.id)}["${esc(n.label)}<br/>${covBadge(c, input.locale)}"]:::${covClass(c)}`);
  }
  const cycle = new Set(model.findings.filter((f) => f.type === "cycle").flatMap((f) => f.nodes));
  for (const e of model.edges) {
    if (e.kind !== "imports" || !inSet.has(e.from) || !inSet.has(e.to)) continue;
    const onCycle = cycle.has(e.from) && cycle.has(e.to);
    lines.push(`  ${nid(e.from)} ${onCycle ? "-.->" : "-->"} ${nid(e.to)}`);
  }
  lines.push(classDefs(p));
  return { source: lines.join("\n"), nodeCount: mods.nodes.length, truncated: mods.truncated };
}

// ───────────────────────────── dispatcher ─────────────────────────────
export function composeDiagram(kind: DiagramKind, input: DiagramInput) {
  const m = redact(input.model, input.audience);
  const di = { ...input, model: m };
  switch (kind) {
    case "D01": case "D09": return composeSystem(di);
    case "D02": return composeErd(di);
    case "D03": return composeModules(di);
    case "D04": return composeApiMap(di);
    case "D05": return composeUiMap(di);
    case "D07": return composePipeline(di);
    case "D08": return composeInfra(di);
    default: return composeSystem(di);
  }
}

export const COMPOSERS: Record<string, { title: { id: string; en: string }; compose: (i: DiagramInput) => { source: string; nodeCount: number; truncated: boolean }; inEmail: boolean; audience: Audience }> = {
  D01: { title: { id: "Konteks sistem & container", en: "System context & container" }, compose: composeSystem, inEmail: true, audience: "customer" },
  D02: { title: { id: "ERD basis data", en: "Database ERD" }, compose: composeErd, inEmail: false, audience: "internal" },
  D03: { title: { id: "Dependensi antar-modul", en: "Module dependencies" }, compose: composeModules, inEmail: false, audience: "internal" },
  D04: { title: { id: "Peta API", en: "API map" }, compose: composeApiMap, inEmail: false, audience: "internal" },
  D05: { title: { id: "Peta halaman UI", en: "UI page map" }, compose: composeUiMap, inEmail: false, audience: "internal" },
  D07: { title: { id: "Pipeline CI/CD", en: "CI/CD pipeline" }, compose: composePipeline, inEmail: true, audience: "customer" },
  D08: { title: { id: "Topologi deploy", en: "Deploy topology" }, compose: composeInfra, inEmail: true, audience: "customer" },
  D09: { title: { id: "Cakupan test pada sistem", en: "Test coverage on system" }, compose: composeSystem, inEmail: true, audience: "customer" },
};

export const MAX_DIAGRAM_NODES = MAX_NODES;
export const escId = esc;
export const clampNodes = (n: number) => clamp(n, 0, MAX_NODES);