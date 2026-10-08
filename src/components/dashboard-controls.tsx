"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RunButton } from "./actions";

export function DashboardControls({ projects, lang }: { projects: Array<{ id: string; name: string }>; lang: "id" | "en" }) {
  const [project, setProject] = useState(projects[0]?.id ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const id = lang === "id";
  return <div className="flex flex-wrap items-end gap-2">
    {projects.length > 0 && <>
      <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-300">
        {id ? "Project untuk dijalankan" : "Project to run"}
        <select value={project} onChange={(e) => setProject(e.target.value)} className="max-w-full rounded-lg border border-slate-600 bg-night-900 px-3 py-2 text-sm">
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <RunButton projectId={project} label={id ? "Jalankan" : "Run"} />
    </>}
    <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending ? (id ? "Memperbarui…" : "Refreshing…") : (id ? "Perbarui data" : "Refresh data")}
    </button>
    <span role="status" className="sr-only">{pending ? (id ? "Memperbarui dashboard" : "Refreshing dashboard") : ""}</span>
  </div>;
}
