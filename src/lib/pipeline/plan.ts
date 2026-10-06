import { TestPlanSchema, type Analysis, type TestPlan } from "../contracts";
import { clamp } from "../util";

const MAX_TESTS_PER_RUN = Number(process.env.VERIFLOW_MAX_TESTS ?? 60);

/**
 * BP-07 — AI Test Planning. Dengan LLM_PROVIDER=mock, plan disusun deterministik dari
 * analysis.json (endpoints, routes, tabel). Dengan provider anthropic, prompt v4 dipakai.
 * Kontrak: satu assertion utama per concept (PRD §16).
 */
export function planTestsDeterministic(a: Analysis, opts: { max?: number } = {}): TestPlan {
  const max = clamp(opts.max ?? MAX_TESTS_PER_RUN, 1, 200);
  const concepts: TestPlan["concepts"] = [];
  const id = (p: string) => p;

  // P0: endpoint kritikal (tidak semua endpoint P0)
  for (const ep of a.api.endpoints) {
    const prio = /order|shipment|checkout|payment|login|auth|track/i.test(ep.path) ? "P0" : "P1";
    concepts.push({
      id: id(`api-happy-${ep.method}-${ep.path}`),
      title: `${ep.method} ${ep.path} — respons sesuai kontrak`,
      layer: "api",
      priority: prio as any,
      tags: ["@api", `@${prio.toLowerCase()}`, ep.auth === "none" ? "@public" : "@auth"],
      preconditions: ep.auth !== "none" ? ["token valid"] : [],
      data_needs: ["fixture respons"],
      assertions: [`status 2xx dan body sesuai schema`],
      endpoint: `${ep.method} ${ep.path}`,
      node: `api:${ep.method} ${ep.path}`,
    });
  }

  // Negative scenario untuk endpoint tulis
  for (const ep of a.api.endpoints.filter((e) => ["POST", "PUT", "PATCH"].includes(e.method)).slice(0, 12)) {
    concepts.push({
      id: id(`api-neg-${ep.method}-${ep.path}`),
      title: `${ep.method} ${ep.path} — tolak payload tidak valid (422)`,
      layer: "api",
      priority: "P1",
      tags: ["@api", "@negative", "@validation"],
      preconditions: ["token valid"],
      data_needs: ["payload kosong"],
      assertions: [`status 422`],
      endpoint: `${ep.method} ${ep.path}`,
      node: `api:${ep.method} ${ep.path}`,
    });
  }

  // UI smoke per route yang terjangkau
  if (a.app.ui_reachable) {
    for (const r of a.app.routes.slice(0, 12)) {
      concepts.push({
        id: id(`ui-smoke-${r.path}`),
        title: `Halaman ${r.path} — heading tampil & tidak error 5xx`,
        layer: "ui",
        priority: "P1",
        tags: ["@ui", "@smoke", r.auth ? "@auth" : "@public"],
        preconditions: r.auth ? ["browser context terautentikasi"] : [],
        data_needs: [],
        assertions: [`halaman tampil tanpa error jaringan`],
        route: r.path,
        node: `route:${r.path}`,
      });
    }
  }

  // E2E alur kritikal bila ada endpoint tulis + route UI
  const write = a.api.endpoints.find((e) => e.method === "POST" && e.path.includes("shipment")) ?? a.api.endpoints.find((e) => e.method === "POST");
  if (write && a.app.routes.length) {
    concepts.push({
      id: "e2e-book-shipment-tracking",
      title: "E2E — booking shipment lalu status terlihat di tracking",
      layer: "e2e",
      priority: "P0",
      tags: ["@e2e", "@smoke", "@p0"],
      preconditions: ["data seed"],
      data_needs: ["origin & destination warehouse"],
      assertions: [`shipment dibuat dan dapat dilacak`],
      endpoint: `${write.method} ${write.path}`,
      route: "/",
    });
  }

  // Prioritas + batas
  const rank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const sorted = concepts.sort((x, y) => rank[x.priority] - rank[y.priority]).slice(0, max);
  return TestPlanSchema.parse({ schema_version: "1.0", concepts: sorted });
}