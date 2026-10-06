import type { TestPlan } from "../contracts";
import type { Workspace } from "../workspace";

export type GeneratedTest = {
  conceptId: string;
  file: string;
  title: string;
  layer: "ui" | "api" | "e2e";
  tags: string[];
  covers: string[];
  priority: string;
  code: string;
};

/**
 * BP-08 — AI Test Generation. Mode mock: template deterministik per layer dengan
 * anotasi `covers` (FR-DGM-10) supaya overlay cakupan selalu punya bukti.
 * Mode anthropic: prompt v2, output divalidasi TestPlan/GeneratedTestContract.
 */
export function generateTests(plan: TestPlan, root = "autoqa"): GeneratedTest[] {
  return plan.concepts.map((c) => {
    const file =
      c.layer === "api" ? `${root}/tests/api/${slug(c.endpoint ?? c.title)}.spec.ts`
      : c.layer === "ui" ? `${root}/tests/ui/${slug(c.route ?? c.title)}.spec.ts`
      : `${root}/tests/e2e/${slug(c.id)}.spec.ts`;
    return {
      conceptId: c.id,
      file,
      title: c.title,
      layer: c.layer,
      tags: c.tags,
      covers: c.node ? [c.node] : [c.endpoint, c.route].filter(Boolean) as string[],
      priority: c.priority,
      code: codeFor(c, root),
    };
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "test";
}

function coversAnnotation(covers: string[]): string {
  return `  test.info().annotations.push({ type: "covers", description: ${JSON.stringify(covers[0])} });`;
}

function codeFor(c: TestPlan["concepts"][number], root: string): string {
  const head = `import { test, expect } from "${root}/fixtures";\n`;
  if (c.layer === "api") {
    const [method, path] = (c.endpoint ?? "GET /").split(" ");
    return `${head}
${coversAnnotation([c.node ?? `api:${c.endpoint}`])}

test.describe("${path} @api", () => {
  test.skip(!process.env.API_BASE_URL, "API_BASE_URL tidak diset");

  test("${c.title}", async ({ request }) => {
    const res = await request.${method.toLowerCase()}("${path}");
    expect(res.status(), "HTTP status").toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThan(300);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
`;
  }
  if (c.layer === "ui") {
    return `${head}
${coversAnnotation([c.node ?? `route:${c.route}`])}

test.describe("${c.route} @ui", () => {
  test.skip(!process.env.BASE_URL, "BASE_URL tidak diset");

  test("${c.title}", async ({ page, authToken }) => {
    await page.goto(\`\${process.env.BASE_URL}${c.route}\`);
    await page.waitForLoadState("networkidle");
    // TODO(gate): ganti dengan locator role/testid yang stabil
    await expect(page.locator("body")).toBeVisible();
  });
});
`;
  }
  return `${head}
${coversAnnotation([c.node ?? "e2e"])}

test.describe("critical journey @e2e", () => {
  test.skip(!process.env.BASE_URL || !process.env.API_BASE_URL, "env tidak lengkap");

  test("${c.title}", async ({ page }) => {
    await page.goto(process.env.BASE_URL!);
    await expect(page.locator("body")).toBeVisible();
    // langkah-langkah journey/plugins derived dari endpoint ${c.endpoint ?? "n/a"}
  });
});
`;
}