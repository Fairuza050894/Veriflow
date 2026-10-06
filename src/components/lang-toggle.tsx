"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LANGS, type Lang } from "@/lib/i18n";

export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (l: Lang) => {
    document.cookie = `vf_lang=${l}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="kpi-label">Bahasa</span>
      <div className={`flex overflow-hidden rounded-lg border border-slate-700/60 ${pending ? "opacity-60" : ""}`}>
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => set(l)}
            aria-pressed={lang === l}
            className={`px-2.5 py-1 text-xs font-semibold transition ${
              lang === l ? "bg-dispatch/15 text-dispatch" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}