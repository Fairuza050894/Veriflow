import type { ReactNode } from "react";
import { fmtPct, fmtNum } from "@/lib/util";

/** Chart SVG buatan sendiri — tanpa dependency charting (lazy: 40 baris vs 300 kB lib). */

export function Sparkline({ data, height = 44, tone = "#22d3ee" }: {
  data: number[]; height?: number; tone?: string;
}) {
  if (data.length < 2) return <div className="text-xs text-slate-600">belum ada data</div>;
  const w = 240;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - ((v - min) / span) * (height - 6) - 3]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${d} L${w},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} role="img" aria-label="sparkline">
      <defs>
        <linearGradient id={`sg-${tone.replace("#", "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${tone.replace("#", "")})`} />
      <path d={d} fill="none" stroke={tone} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={tone} />
    </svg>
  );
}

export function PassTrend({ points }: { points: Array<{ day: string; rate: number; runs: number }> }) {
  if (points.length < 2) return <p className="px-5 pb-6 text-xs text-slate-600">Belum ada cukup histori run.</p>;
  const w = 640, h = 180, padX = 34, padY = 18;
  const rates = points.map((p) => p.rate);
  const min = Math.max(0, Math.min(...rates) - 0.05);
  const max = Math.min(1, Math.max(...rates) + 0.05);
  const x = (i: number) => padX + (i / (points.length - 1)) * (w - padX * 2);
  const y = (v: number) => padY + (1 - (v - min) / (max - min || 1)) * (h - padY * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rate).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - padY} L${padX},${h - padY} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="tren pass rate">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={padX} x2={w - padX} y1={padY + f * (h - padY * 2)} y2={padY + f * (h - padY * 2)} stroke="#1e2b47" strokeDasharray="3 4" />
          <text x={4} y={padY + f * (h - padY * 2) + 4} fill="#475569" fontSize="10">{fmtPct(min + f * (max - min))}</text>
        </g>
      ))}
      <defs>
        <linearGradient id="pt" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#pt)" />
      <path d={line} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={p.day}>
          <circle cx={x(i)} cy={y(p.rate)} r="3.2" fill="#05080f" stroke="#22d3ee" strokeWidth="1.6" />
          <title>{`${p.day}: ${fmtPct(p.rate, 1)} (${p.runs} run)`}</title>
        </g>
      ))}
      {points.map((p, i) => (i % Math.ceil(points.length / 6) === 0 ? (
        <text key={`l-${p.day}`} x={x(i)} y={h - 4} fill="#475569" fontSize="9" textAnchor="middle">{p.day.slice(5)}</text>
      ) : null))}
    </svg>
  );
}

export function BarList({ items, tone = "#22d3ee", format }: {
  items: Array<{ label: string; value: number }>; tone?: string; format?: (v: number) => string;
}) {
  if (!items.length) return <p className="px-5 pb-6 text-xs text-slate-600">Tidak ada data.</p>;
  const max = Math.max(...items.map((i) => i.value)) || 1;
  return (
    <ul className="space-y-2 px-5 pb-5">
      {items.map((it) => (
        <li key={it.label}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-slate-300" title={it.label}>{it.label}</span>
            <span className="mono shrink-0 text-slate-400">{format ? format(it.value) : fmtNum(it.value)}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-night-700">
            <div className="h-full rounded-full" style={{ width: `${(it.value / max) * 100}%`, background: tone, boxShadow: `0 0 12px -2px ${tone}` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Donut({ slices, center }: { slices: Array<{ label: string; value: number; color: string }>; center?: ReactNode }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 42, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-5 px-5 pb-5">
      <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0" role="img" aria-label="distribusi kategori kegagalan">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#16213a" strokeWidth="12" />
        {total > 0 && slices.map((s) => {
          const len = (s.value / total) * c;
          const el = (
            <circle key={s.label} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="12"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)" />
          );
          acc += len;
          return el;
        })}
        {center}
      </svg>
      <ul className="space-y-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
            <span className="text-slate-300">{s.label.replace(/_/g, " ")}</span>
            <span className="mono text-slate-500">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}