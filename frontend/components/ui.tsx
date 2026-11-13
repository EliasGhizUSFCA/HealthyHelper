"use client";

import type { ReactNode } from "react";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export function LabCard({ title, subtitle, actions, children, className, id }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className={cx("flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/70", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1.5">
        <div className="min-w-0">
          <h2 id={id ? `${id}-title` : undefined} className="truncate text-xs font-semibold uppercase tracking-wider text-zinc-300">
            {title}
          </h2>
          {subtitle && <p className="truncate text-[10px] text-zinc-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2.5">{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "border-zinc-700 bg-zinc-800 text-zinc-300",
  ok: "border-emerald-700/60 bg-emerald-900/40 text-emerald-300",
  warn: "border-amber-700/60 bg-amber-900/40 text-amber-300",
  error: "border-rose-700/60 bg-rose-900/40 text-rose-300",
  info: "border-cyan-700/60 bg-cyan-900/40 text-cyan-300",
  violet: "border-violet-700/60 bg-violet-900/40 text-violet-300",
  skip: "border-zinc-700 bg-zinc-900 text-zinc-500",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] uppercase leading-4", TONES[tone])}>
      {children}
    </span>
  );
}

export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case "ok":
    case "accepted":
    case "acceptable":
    case "open":
    case "validated":
      return "ok";
    case "warning":
    case "inconclusive":
    case "poor":
    case "reconnecting":
    case "connecting":
    case "demo":
    case "experimental":
      return "warn";
    case "error":
    case "unusable":
    case "closed":
      return "error";
    case "skipped":
    case "abstained":
    case "unavailable":
    case "idle":
      return "skip";
    default:
      return "neutral";
  }
}

export function LabToggle({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label title={title} className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-zinc-300">
      <input type="checkbox" className="h-3 w-3 accent-cyan-400" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function LabButton({ children, onClick, active, disabled, title, tone = "default" }: { children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; title?: string; tone?: "default" | "danger" | "primary" }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded border px-2 py-0.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
        tone === "danger" && "border-rose-700 bg-rose-950 text-rose-200 hover:bg-rose-900",
        tone === "primary" && "border-cyan-600 bg-cyan-900/60 text-cyan-100 hover:bg-cyan-800",
        tone === "default" && (active ? "border-violet-500 bg-violet-900/60 text-violet-100" : "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"),
      )}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, unit, title }: { label: string; value: string | number | null | undefined; unit?: string; title?: string }) {
  return (
    <div title={title} className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-mono text-sm tabular-nums text-zinc-100">
        {value ?? "—"}
        {unit && value != null && <span className="ml-0.5 text-[10px] text-zinc-500">{unit}</span>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-16 items-center justify-center rounded border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-500">{children}</div>;
}

export function SimulatedBanner() {
  return (
    <div role="note" className="rounded border border-fuchsia-600 bg-fuchsia-950/70 px-2 py-0.5 text-center font-mono text-[10px] font-bold uppercase tracking-widest text-fuchsia-200">
      Simulated input — procedurally generated, not a camera image
    </div>
  );
}

/** Badge for any non-validated model tier. Demo and experimental outputs must never render without it. */
export function TierBadge({ tier }: { tier: string }) {
  if (tier === "validated") return null;
  const label = tier === "demo" ? "Demo" : tier === "experimental" ? "Experimental" : tier === "unavailable" ? "Not loaded" : tier;
  const cls = tier === "demo" ? "bg-fuchsia-600" : tier === "experimental" ? "bg-sky-600" : "bg-slate-500";
  return <span className={cx("ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white", cls)}>{label}</span>;
}
