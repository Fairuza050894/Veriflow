"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Viewer Mermaid.
 * §18.16 keamanan: `securityLevel: "strict"` → direktif `click` (javascript:) dinonaktifkan.
 * ponytail: satu-satunya dependency charting. Diagram-as-code tetap sumber kebenaran;
 * SVG di-render di client, fallback ke <pre> bila render gagal (tidak pernah blank).
 */
export function MermaidView({ code, id }: { code: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "default",
          themeVariables: { fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: "13px" },
        });
        const { svg } = await mermaid.render(`m-${id}-${Math.random().toString(36).slice(2, 7)}`, code);
        if (alive && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message.split("\n")[0]);
      }
    })();
    return () => { alive = false; };
  }, [code, id]);

  if (error) {
    return (
      <div className="rounded-xl border border-stop/30 bg-stop/5 p-4">
        <p className="mb-2 text-xs font-semibold text-stop">Render diagram gagal — menampilkan sumber diagram-as-code.</p>
        <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap text-[11px] text-slate-400">{code}</pre>
      </div>
    );
  }
  return <div ref={ref} className="mermaid min-h-[120px] w-full overflow-x-auto" />;
}