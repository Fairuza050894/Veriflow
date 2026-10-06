import { AnalysisSchema, type Analysis } from "../contracts";
import type { Workspace } from "../workspace";
import { lineOf } from "../util";

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|py|java|kt|go|php|rb|json|yaml|yml|prisma|md)$/;

function has(files: Record<string, string>, re: RegExp): boolean {
  return Object.keys(files).some((f) => re.test(f));
}

/**
 * Analyzer deterministik (PRD BP-05). Tidak ada LLM: semua fakta dari isi repo.
 * Kontrak output: AnalysisSchema (FR-ANA-05).
 */
export function analyzeRepo(ws: Workspace): Analysis {
  const files = ws.files;
  const risks: string[] = [];
  const recommendations: string[] = [];

  // ---- stack ----
  let language = "unknown";
  let packageManager = "npm";
  let frameworks: string[] = [];
  let node = "";

  if (has(files, /(^|\/)package\.json$/)) {
    language = /(^|\/)(tsconfig\.json)$/.test(Object.keys(files).join("|")) ? "typescript" : "javascript";
    if (has(files, /pnpm-lock\.yaml/)) packageManager = "pnpm";
    else if (has(files, /yarn\.lock/)) packageManager = "yarn";
    else if (has(files, /bun\.lockb/)) packageManager = "bun";

    const pkg = pickPkg(files);
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    node = String(pkg?.engines?.node ?? "").replace(/[<>=^~\s]*/g, "");

    const fw: Array<[string, string]> = [
      ["nextjs", "next"], ["nuxt", "nuxt"], ["react", "react"], ["vue", "vue"],
      ["svelte", "svelte"], ["angular", "@angular/core"], ["nestjs", "@nestjs/core"],
      ["express", "express"], ["fastify", "fastify"], ["laravel", "laravel/framework"],
      ["spring-boot", "spring-boot-starter"], ["django", "django"], ["fastapi", "fastapi"],
      ["prisma", "prisma"], ["playwright", "@playwright/test"],
    ];
    frameworks = fw.filter(([, dep]) => dep in deps).map(([name]) => name);
  } else if (has(files, /requirements\.txt$|pyproject\.toml$/)) {
    language = "python";
  } else if (has(files, /pom\.xml$|build\.gradle/)) {
    language = "java";
  } else if (has(files, /composer\.json$/)) {
    language = "php";
  } else if (has(files, /go\.mod$/)) {
    language = "go";
  }

  // ---- routes UI ----
  const routes: Analysis["app"]["routes"] = [];
  const AUTH_ROUTE = /^\/(login|signin|auth|register)/;
  for (const [file, content] of Object.entries(files)) {
    const m =
      file.match(/^src\/app\/(.*)\/page\.(tsx|jsx|ts|js)$/) ??
      file.match(/^pages\/(.*)\.(tsx|jsx|ts|js)$/);
    if (m) {
      const p = "/" + m[1].replace(/\/\([^/]+\)/g, "").replace(/\/\[([^\]]+)\]/g, "/:$1").replace(/\/$/, "");
      routes.push({ path: p || "/", file, auth: !AUTH_ROUTE.test(p) });
      continue;
    }
    const vue = file.match(/^src\/(?:pages|views)\/(.*)\.vue$/);
    if (vue) {
      const p = "/" + vue[1].replace(/\/index$/, "");
      routes.push({ path: p, file, auth: !AUTH_ROUTE.test(p) });
      continue;
    }
    const r = [...content.matchAll(/(?:router\.(?:get|post|put|delete|patch)|app\.(?:get|post|put|delete|patch)|@(Get|Post|Put|Delete|Patch)\()\s*\(?["'`]([^"'`]+)["'`]/g)];
    for (const mm of r) {
      routes.push({ path: mm[2], file, auth: /requireAuth|AuthGuard|jwt|auth/i.test(content) });
    }
  }

  // ---- API spec ----
  const specFile = Object.keys(files).find((f) => /(openapi|swagger)\.(ya?ml|json)$/i.test(f));
  let api: Analysis["api"];
  if (specFile) {
    const endpoints = parseOpenapi(files[specFile] ?? "");
    api = { spec: { type: "openapi", path: specFile, version: String(files[specFile].match(/openapi:\s*([\d.]+)/)?.[1] ?? "") }, endpoints };
  } else {
    const gql = Object.keys(files).find((f) => /\.graphqls?$/.test(f));
    api = gql
      ? { spec: { type: "graphql", path: gql }, endpoints: parseGraphql(files[gql] ?? "") }
      : { spec: { type: "routes-scan" }, endpoints: parseRouteHandlers(files) };
  }

  // ---- testids ----
  let withId = 0, total = 0;
  for (const [file, content] of Object.entries(files)) {
    if (!file.includes("components") && !/\/app\//.test(file) && !/pages\//.test(file)) continue;
    total++;
    if (/data-testid=/.test(content)) withId++;
  }
  const testidsCoverage = total ? withId / total : 0;

  // ---- auth ----
  const authFile = Object.keys(files).find((f) => /auth\.(ts|js|py|go|java)$/.test(f));
  const loginRoute = routes.find((r) => AUTH_ROUTE.test(r.path))?.path;
  const auth = {
    strategy: authFile && loginRoute ? "ui-login" : api.endpoints.some((e) => e.auth !== "none") ? "bearer" : "none",
    ...(loginRoute ? { login_route: loginRoute } : {}),
  };

  // ---- existing tests ----
  const existing = countExistingTests(files);
  if (!existing.playwright && existing.count === 0) recommendations.push("No test suite found — generated suite will be the first baseline");

  // ---- risks & recommendations ----
  if (!specFile && api.endpoints.length === 0) risks.push("tidak_ditemukan_api_spec");
  if (testidsCoverage < 0.5) recommendations.push("add data-testid to interactive components to stabilise locators");
  if (api.endpoints.some((e) => e.auth === "none")) risks.push("public_endpoint_without_auth");
  if (AUTH_ROUTE.test(loginRoute ?? "") && has(files, /captcha/i)) risks.push("captcha_on_login");
  if (!has(files, /docker-compose|compose\.ya?ml|Dockerfile/)) risks.push("no_container_definition_found");
  if (!has(files, /\.github\/workflows|\.gitlab-ci\.yml|Jenkinsfile/)) risks.push("no_ci_pipeline_found");
  if (testidsCoverage > 0 && testidsCoverage < 0.4) risks.push("low_testid_coverage");

  const uiReachable = !risks.includes("captcha_on_login");
  if (!uiReachable) recommendations.push("UI tests skipped: target requires CAPTCHA — request a bypass test account");

  return AnalysisSchema.parse({
    schema_version: "1.0",
    repo: { url: ws.url, commit: ws.commit, subfolder: ".", bytes: ws.bytes, files: Object.keys(files).length },
    stack: { language, frameworks, package_manager: packageManager, node },
    app: { base_url_candidates: [], routes, testids_coverage: Number(testidsCoverage.toFixed(2)), ui_reachable: uiReachable },
    api,
    auth,
    existing_tests: existing,
    risks,
    recommendations,
  });
}

function pickPkg(files: Record<string, string>) {
  const p = Object.keys(files).find((f) => /(^|\/)package\.json$/.test(f));
  if (!p) return null;
  try { return JSON.parse(files[p]) as Record<string, any>; } catch { return null; }
}

/** Parser YAML sekecil mungkin: cukup untuk OpenAPI paths + security (tanpa dependency). */
export function parseOpenapi(text: string): Analysis["api"]["endpoints"] {
  const out: Analysis["api"]["endpoints"] = [];
  const lines = text.split("\n");
  let inPaths = false;
  let currentPath: string | null = null;
  let currentMethod: string | null = null;
  const METHODS = ["get", "post", "put", "delete", "patch"];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (!inPaths) continue;
    if (/^[a-z]+:\s*$/.test(line)) { inPaths = false; continue; }

    const p = line.match(/^  (\/[^\s:]*):\s*$/);
    if (p) { currentPath = p[1]; currentMethod = null; continue; }

    const m = line.match(/^    (get|post|put|delete|patch):\s*$/i);
    if (m && currentPath) {
      currentMethod = m[1].toUpperCase();
      // security: [] = tanpa auth; default diasumsikan perlu auth bila ada bearerAuth
      const authBlock = lines.slice(i + 1, i + 12).join("\n");
      const hasSecurityHeader = /security:\s*\[/.test(authBlock);
      const emptySecurity = /security:\s*\[\s*\]/.test(authBlock);
      out.push({
        method: currentMethod,
        path: currentPath,
        auth: hasSecurityHeader && !emptySecurity ? "bearer" : "none",
      });
      continue;
    }
  }
  return out;
}

function parseGraphql(text: string): Analysis["api"]["endpoints"] {
  const out: Analysis["api"]["endpoints"] = [];
  for (const type of ["Query", "Mutation"] as const) {
    const re = new RegExp(`${type}\\s*\\{([\\s\\S]*?)\\n\\}`, "g");
    for (const block of text.matchAll(re)) {
      for (const f of block[1].matchAll(/^\s*(\w+)\s*[(]/gm)) {
        out.push({ method: type === "Query" ? "GET" : "POST", path: `/${f[1]}`, auth: "bearer" });
      }
    }
  }
  return out;
}

function parseRouteHandlers(files: Record<string, string>): Analysis["api"]["endpoints"] {
  const out: Analysis["api"]["endpoints"] = [];
  for (const [file, content] of Object.entries(files)) {
    const api = file.match(/^src\/app\/api\/(.*)\/route\.(ts|js)$/);
    if (!api) continue;
    const p = "/" + api[1].replace(/\/\[[^\]]+\]/g, "/:param").replace(/\/$/, "");
    for (const m of content.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)/g)) {
      out.push({
        method: m[1],
        path: p,
        auth: /requireAuth|verifyToken|AuthGuard|jwt/i.test(content) ? "bearer" : "none",
        file,
        line: lineOf(content, `function ${m[1]}`),
      });
    }
  }
  return out;
}

function countExistingTests(files: Record<string, string>): Analysis["existing_tests"] {
  const filesList = Object.keys(files).filter((f) => /(^|\/)(tests?|__tests__|spec)\//.test(f) || /\.(spec|test)\.[jt]sx?$/.test(f));
  const playwright = filesList.some((f) => /@playwright\/test/.test(files[f]));
  return {
    framework: playwright ? "playwright" : filesList.length ? "jest" : "none",
    count: filesList.length,
    playwright,
  };
}

export const TEXT_FILTER = TEXT_EXT;