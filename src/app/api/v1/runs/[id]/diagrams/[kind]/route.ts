import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { notFound, problem } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/runs/{id}/diagrams/{kind}?format=svg|png|pdf|src&audience=
 * ponytail: server tidak bisa merender Mermaid tanpa headless browser.
 * `src` (Mermaid source) + `viewer` HTML halaman dashboard adalah deliverable;
 * PNG/PDF untuk email dibuat oleh runner (`/api/v1/internals/render`) atau mmdc.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") ?? "src";
  const row = await one<{ id: string; source: string; syntax: string; title: string; alt_text: string | null; status: string }>(
    "SELECT id, source, syntax, title, alt_text, status FROM diagrams WHERE run_id = ? AND kind = ?", [id, kind.toUpperCase()]);
  if (!row) return notFound(`Diagram ${kind} tidak tersedia`);
  if (row.status === "skipped") return problem(424, `Diagram ${kind} dilewati: ${row.alt_text ?? "tidak diketahui"}`);

  if (format === "src") {
    return new NextResponse(row.source, {
      headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `inline; filename="${kind}.mmd"` },
    });
  }
  if (format === "png" || format === "pdf" || format === "svg") {
    return problem(501, `Render ${format.toUpperCase()} dijalankan di runner diagram (mmdc/d2/graphviz), bukan di control plane. Lihat docs/DEPLOYMENT.md §Diagram PNG`);
  }
  return problem(400, "format tidak dikenal");
}