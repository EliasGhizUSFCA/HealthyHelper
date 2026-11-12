import Link from "next/link";

const LINKS = [
  { href: "/mirror", label: "Health Mirror" },
  { href: "/lab", label: "Model Lab" },
  { href: "/history", label: "Comparisons" },
  { href: "/privacy", label: "Privacy" },
];

export function SiteNav({ dark = false, current }: { dark?: boolean; current?: string }) {
  return (
    <nav aria-label="Main" className={dark ? "flex items-center gap-3 text-xs" : "flex flex-wrap items-center gap-4 text-sm"}>
      <Link href="/" className={dark ? "font-semibold text-zinc-100" : "font-semibold text-slate-900"}>
        AI Health Mirror
      </Link>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={current === l.href ? "page" : undefined}
          className={
            dark
              ? `rounded px-1.5 py-0.5 ${current === l.href ? "bg-zinc-800 text-cyan-300" : "text-zinc-400 hover:text-zinc-100"}`
              : `rounded px-2 py-1 ${current === l.href ? "bg-sky-100 text-sky-900" : "text-slate-600 hover:text-slate-900"}`
          }
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
