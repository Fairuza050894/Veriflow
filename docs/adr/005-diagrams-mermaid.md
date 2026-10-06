# ADR 005: Mermaid Source Stored, Client-Side Render

**Date**: 2026-10-06
**Status**: Accepted

## Context

Spec requires 9 diagram kinds (D01–D09) + D10 diff, rendered as PNG/SVG/PDF for email and dashboard.

Options:
1. **Server-side render** (Puppeteer/Playwright → PNG) — heavy, needs headless browser on Vercel
2. **Mermaid CLI** — Node wrapper, same problem
3. **Client-side Mermaid.js** — browser renders SVG from source
4. **Diagram runner service** — separate microservice (K8s/VPS) for PNG/PDF

## Decision

**Store Mermaid source in DB (`diagrams.source`), render client-side via dynamic `import("mermaid")`.**

### Implementation

```typescript
// diagrams/[kind]/route.ts
export async function GET(_req, { params: { kind } }) {
  const src = one("SELECT source FROM diagrams WHERE run_id=? AND kind=?", [runId, kind]);
  return Response.json({ source: src?.source });
}

// Client (mermaid-view.tsx)
const mermaid = await import("mermaid");
mermaid.initialize({ securityLevel: "strict", startOnLoad: false });
const { svg } = await mermaid.render(`diagram-${kind}`, source);
```

### Email: PNG Required

Spec: "Email report includes max 3 diagram PNG inline".

**Solution**: API returns `501 Not Implemented` for `Accept: image/png` with `Retry-After` pointing to diagram runner.

```typescript
// diagrams/[kind]/route.ts
if (req.headers.get("accept")?.includes("image/png")) {
  return new Response(
    JSON.stringify({ error: "PNG rendering delegated to diagram runner" }),
    { status: 501, headers: { "Content-Type": "application/json" } }
  );
}
```

**Diagram Runner** (future, V1):
- Small service (Cloud Run / Fly.io / Lambda)
- Input: Mermaid source → Output: PNG/PDF
- Called by email builder at `REPORTING` step

### Security

- `mermaid.initialize({ securityLevel: "strict" })` — no HTML/script injection
- Source stored from trusted extractors only
- CSP: `script-src 'self' 'wasm-unsafe-eval'` (Mermaid uses WASM)

## Consequences

| Positive | Negative |
|----------|----------|
| Zero server deps (no Puppeteer) | Email gets SVG fallback (alt text) |
| Interactive (zoom, pan) in dashboard | PNG requires separate service |
| Instant render (browser GPU) | Large diagrams (>150 nodes) slow |
| Source = truth (versionable) | Mermaid layout sometimes suboptimal |

## Truncation Strategy

`MAX_NODES = 150` in `compose.ts`:
- Score nodes: `centrality + failures*5 + noTest*3`
- Keep top-N
- Add `truncated: true` flag → UI shows "Showing 150 of 342 nodes"

## Alternatives Considered

| Option | Verdict |
|--------|---------|
| D2 / Graphviz server-side | ❌ Native deps, same Vercel problem |
| Kroki.io (external) | ❌ External dependency, latency |
| Mermaid CLI at build | ❌ Diagrams are run-specific (dynamic) |
| Excalidraw / custom SVG | ❌ Reinventing layout engine |

## Migration Path (V1)

1. Deploy diagram runner (Cloud Run: `mermaid-cli` + Puppeteer)
2. Email builder calls runner → gets PNG → inlines base64
3. Dashboard: keep client Mermaid for interactivity
4. PDF export: runner batch-renders all diagrams → ZIP