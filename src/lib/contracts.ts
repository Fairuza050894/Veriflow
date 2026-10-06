import { z } from "zod";

// Kontrak data antar-step (Arsitektur §16 & §18.3).
// Semua output step divalidasi dengan skema ini sebelum masuk DB —
// inilah "FR-ANA-05" & guardrail #3 di §10.3.

const evidence = z.object({
  file: z.string(),
  line: z.number().int().nonnegative().optional(),
  commit: z.string().optional(),
});

export const AnalysisSchema = z.object({
  schema_version: z.literal("1.0"),
  repo: z.object({
    url: z.string(),
    commit: z.string(),
    subfolder: z.string().default("."),
    bytes: z.number().nonnegative().default(0),
    files: z.number().int().nonnegative().default(0),
  }),
  stack: z.object({
    language: z.string(),
    frameworks: z.array(z.string()).default([]),
    package_manager: z.string(),
    node: z.string().default(""),
  }),
  app: z.object({
    base_url_candidates: z.array(z.string()).default([]),
    routes: z.array(z.object({
      path: z.string(),
      file: z.string().optional(),
      auth: z.boolean().default(false),
    })).default([]),
    testids_coverage: z.number().min(0).max(1).default(0),
    ui_reachable: z.boolean().default(true),
  }),
  api: z.object({
    spec: z
      .object({ type: z.enum(["openapi", "graphql", "postman", "routes-scan", "none"]), path: z.string().optional(), version: z.string().optional() })
      .default({ type: "none" }),
    endpoints: z.array(z.object({
      method: z.string(),
      path: z.string(),
      auth: z.string().default("none"),
      file: z.string().optional(),
      line: z.number().int().optional(),
    })).default([]),
  }),
  auth: z.object({
    strategy: z.string().default("none"),
    login_route: z.string().optional(),
  }),
  existing_tests: z
    .object({ framework: z.string().default("none"), count: z.number().int().default(0), playwright: z.boolean().default(false) })
    .default({ framework: "none", count: 0, playwright: false }),
  risks: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const TestPlanSchema = z.object({
  schema_version: z.literal("1.0"),
  concepts: z.array(z.object({
    id: z.string(),
    title: z.string(),
    layer: z.enum(["ui", "api", "e2e"]),
    priority: z.enum(["P0", "P1", "P2", "P3"]),
    tags: z.array(z.string()),
    preconditions: z.array(z.string()).default([]),
    data_needs: z.array(z.string()).default([]),
    assertions: z.array(z.string()).min(1),
    endpoint: z.string().optional(),
    route: z.string().optional(),
    node: z.string().optional(),
  })).min(1),
});
export type TestPlan = z.infer<typeof TestPlanSchema>;

const nodeKind = z.enum(["service", "database", "table", "endpoint", "route", "module", "pipeline_stage", "cloud_resource", "external"]);
const confidence = z.enum(["extracted", "inferred", "observed"]);

export const ArchModelSchema = z.object({
  schema_version: z.literal("1.0"),
  snapshot_id: z.string(),
  repo: z.object({ commit: z.string(), subfolder: z.string() }),
  extractors: z.array(z.object({
    name: z.string(), version: z.string(), status: z.enum(["ok", "failed", "skipped"]), reason: z.string().optional(),
  })),
  nodes: z.array(z.object({
    id: z.string(),
    kind: nodeKind,
    label: z.string(),
    tech: z.string().optional(),
    group: z.string().optional(),
    evidence: z.array(evidence).default([]),
    confidence: confidence,
    sensitive: z.boolean().default(false),
    internal_only: z.boolean().default(false),
    columns: z.array(z.object({
      name: z.string(), type: z.string(), pk: z.boolean().default(false),
      fk: z.string().optional(), sensitive: z.boolean().default(false),
    })).optional(),
    attrs: z.record(z.unknown()).default({}),
  })),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    kind: z.string(),
    confidence: confidence,
    evidence: z.array(evidence).default([]),
  })),
  findings: z.array(z.object({
    id: z.string(), type: z.string(), severity: z.string(),
    nodes: z.array(z.string()), detail: z.string().default(""),
    evidence: z.array(evidence).default([]),
  })).default([]),
});
export type ArchModel = z.infer<typeof ArchModelSchema>;

export const CoverageEntrySchema = z.object({
  tests: z.number().int().default(0),
  passed: z.number().int().default(0),
  failed: z.number().int().default(0),
  flaky: z.number().int().default(0),
  state: z.enum(["passed", "failed", "flaky", "untested"]),
});
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;