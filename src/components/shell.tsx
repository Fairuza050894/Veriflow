import Link from "next/link";
import type { ReactNode } from "react";
import { getLang } from "@/lib/lang-server";
import { t, LANGS } from "@/lib/i18n";
import { LangToggle } from "./lang-toggle";

const NAV = [
  { href: "/", key: "nav.overview" as const, icon: "◈" },
  { href: "/projects", key: "nav.projects" as const, icon: "▣" },
  { href: "/tests", key: "nav.tests" as const, icon: "⌾" },
  { href: "/architecture", key: "nav.architecture" as const, icon: "⧉" },
  { href: "/emails", key: "nav.emails" as const, icon: "✉" },
  { href: "/prompts", key: "nav.prompts" as const, icon: "❯" },
  { href: "/settings", key: "nav.settings" as const, icon: "⚙" },
];

export async function Shell({ children }: { children: ReactNode }) {
  const lang = await getLang();
  return (
    <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1500px] gap-0 px-4 py-4 lg:px-6">
      <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-60 shrink-0 flex-col gap-4 lg:flex">
        <Link href="/" className="panel glow-cyan flex items-center gap-3 px-4 py-3">
          <Brandmark />
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-[0.16em] text-slate-50">VERIFLOW</div>
            <div className="text-[10px] uppercase tracking-widest text-dispatch/70">test orchestration</div>
          </div>
        </Link>

        <nav className="panel flex-1 space-y-1 p-2.5">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href} label={t(lang, n.key)} icon={n.icon} />
          ))}
        </nav>

        <div className="panel space-y-3 p-4">
          <p className="kpi-label">Pipeline health</p>
          <HealthBar />
          <LangToggle lang={lang} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="panel mb-4 flex items-center justify-between gap-3 px-4 py-2.5 lg:hidden">
          <Link href="/" className="flex items-center gap-2">
            <Brandmark />
            <span className="text-xs font-bold tracking-[0.16em]">VERIFLOW</span>
          </Link>
          <div className="flex gap-1 overflow-x-auto">
            {NAV.slice(0, 5).map((n) => (
              <Link key={n.href} href={n.href} className="chip text-slate-300 hover:border-dispatch/50 hover:text-dispatch">
                {n.icon}
              </Link>
            ))}
          </div>
        </header>
        <main className="rise">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-100"
    >
      <span className="mono text-xs text-slate-600 transition group-hover:text-dispatch">{icon}</span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto h-1 w-1 rounded-full bg-dispatch/0 transition group-hover:bg-dispatch" />
    </Link>
  );
}

function HealthBar() {
  const bars = [
    { h: 42, tone: "bg-go" }, { h: 62, tone: "bg-go" }, { h: 50, tone: "bg-go" }, { h: 78, tone: "bg-amber-glow" },
    { h: 66, tone: "bg-go" }, { h: 88, tone: "bg-dispatch" }, { h: 72, tone: "bg-go" }, { h: 94, tone: "bg-dispatch" },
  ];
  return (
    <div className="flex h-12 items-end gap-1" aria-hidden>
      {bars.map((b, i) => (
        <div key={i} className={`flex-1 rounded-sm ${b.tone} opacity-70`} style={{ height: `${b.h}%` }} />
      ))}
    </div>
  );
}

function Brandmark() {
  return (
    <span className="relative grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-amber-glow to-amber-deep text-night-950 shadow-[0_8px_24px_-10px_rgba(245,158,11,0.8)]">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M3 7h11v10H3z" />
        <path d="M14 10h4l3 3v4h-7z" />
        <circle cx="7" cy="18" r="1.8" />
        <circle cx="17.5" cy="18" r="1.8" />
      </svg>
    </span>
  );
}

export { LANGS };