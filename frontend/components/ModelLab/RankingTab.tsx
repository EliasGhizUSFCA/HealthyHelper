"use client";

import { useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { DEFAULT_FORM, RecommendationForm, type FormRequest } from "@/components/Beauty/RecommendationForm";
import { Badge, Empty, LabCard } from "@/components/ui";
import { contributionSegments, formatPrice } from "@/lib/beauty";
import type { RankedProduct } from "@/lib/catalog";
import { fmt, humanize } from "@/lib/format";

export const COMPONENT_COLORS: Record<string, string> = {
  category_relevance: "#64748b",
  concern_match: "#f472b6",
  text_relevance: "#a78bfa",
  ingredient_preference: "#34d399",
  budget_fit: "#facc15",
  availability: "#38bdf8",
  finish_match: "#fb923c",
  coverage_match: "#f87171",
  shade_match: "#e879f9",
  data_reliability: "#94a3b8",
};

export function ContributionBar({ r }: { r: RankedProduct }) {
  const seg = contributionSegments(r.components);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded bg-zinc-800" role="img" aria-label={`score ${r.total_score.toFixed(3)}`}>
        {seg.known.map((s) => (
          <div key={s.name} title={`${s.name}: ${s.score.toFixed(2)} × w${s.weight} → ${s.width.toFixed(3)}`} style={{ width: `${s.width * 100}%`, background: COMPONENT_COLORS[s.name] ?? "#71717a" }} />
        ))}
      </div>
      {seg.missing.length > 0 && <p className="mt-0.5 text-[9px] text-zinc-500">missing — excluded: {seg.missing.map(humanize).join(", ")}</p>}
    </div>
  );
}

export function RankingTab() {
  const engine = useEngine();
  const { recommendation } = useEngineState();
  const [form, setForm] = useState<FormRequest>(DEFAULT_FORM);
  const [open, setOpen] = useState<string | null>(null);
  const res = recommendation.response;
  const tr = res?.trace;
  return (
    <LabCard title="Recommendation ranking" subtitle="Deterministic, inspectable scores from the backend ranking engine — not LLM-generated">
      <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-2">
          <RecommendationForm dark value={form} onChange={setForm} onSubmit={() => void engine.recommend(form)} pending={recommendation.pending} />
          <div className="flex flex-wrap gap-1">
            {Object.entries(COMPONENT_COLORS).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1 text-[9px] text-zinc-400">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: c }} />
                {humanize(k)}
              </span>
            ))}
          </div>
        </div>
        <div className="min-w-0 space-y-3 text-[11px]">
          {recommendation.error && <div className="rounded border border-rose-800 bg-rose-950/50 px-2 py-1 text-rose-200">{recommendation.error}</div>}
          {!res ? (
            <Empty>Run a request to see candidates, filters and per-component contributions.</Empty>
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                <Badge tone="info">source {tr!.retrieval_source}</Badge>
                <Badge>live retailer requests {tr!.live_requests}</Badge>
                <Badge>candidates {tr!.candidates}</Badge>
                <Badge>after filters {tr!.after_filters}</Badge>
                <Badge tone={tr!.age_used ? "warn" : "skip"}>age used: {tr!.age_used ? "yes" : "no"}</Badge>
                <Badge tone={tr!.stale_in_results ? "warn" : "ok"}>stale in results {tr!.stale_in_results}</Badge>
                {Object.entries(tr!.timings_ms).map(([k, v]) => (
                  <Badge key={k}>
                    {k} {fmt(v, 1)}ms
                  </Badge>
                ))}
              </div>
              <p className="text-zinc-400">
                categories: {tr!.categories_searched.join(", ")} · terms: {tr!.search_terms.join(" | ") || "—"} · {tr!.age_note}
              </p>
              <table className="w-full table-fixed">
                <thead className="text-left text-[9px] uppercase text-zinc-500">
                  <tr>
                    <th className="w-8">#</th>
                    <th className="w-[34%]">product</th>
                    <th className="w-14">score</th>
                    <th>contributions (known components only, normalised)</th>
                  </tr>
                </thead>
                <tbody>
                  {res.results.map((r) => (
                    <tr key={r.product.product_id} className="cursor-pointer border-t border-zinc-800 align-top hover:bg-zinc-900" onClick={() => setOpen(open === r.product.product_id ? null : r.product.product_id)}>
                      <td className="font-mono">{r.rank}</td>
                      <td className="truncate" title={r.product.name}>
                        {r.product.brand} · {r.product.name}
                        <div className="text-zinc-500">{formatPrice(r.product)}</div>
                      </td>
                      <td className="font-mono">{r.total_score.toFixed(3)}</td>
                      <td>
                        <ContributionBar r={r} />
                        {open === r.product.product_id && (
                          <table className="mt-1 w-full text-[10px]">
                            <tbody>
                              {r.components.map((c) => (
                                <tr key={c.name} className="border-t border-zinc-800/60">
                                  <td className="w-32">{humanize(c.name)}</td>
                                  <td className="w-10 font-mono">w {c.weight}</td>
                                  <td className="w-14 font-mono">{c.score == null ? "missing" : c.score.toFixed(3)}</td>
                                  <td className="w-14 font-mono">{c.contribution.toFixed(3)}</td>
                                  <td className="text-zinc-400">{c.detail}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        {r.warnings.length > 0 && <p className="text-[9px] text-amber-300">{r.warnings.join(" · ")}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <details>
                <summary className="cursor-pointer text-zinc-300">Filtered out ({tr!.filtered_out.length})</summary>
                <ul className="mt-1 max-h-40 overflow-auto">
                  {tr!.filtered_out.map((f) => (
                    <li key={f.product_id}>
                      <span className="text-zinc-300">{f.name}</span> — <span className="text-amber-300">{f.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <p className="text-[9px] uppercase text-zinc-500">weights</p>
                  <pre className="rounded bg-black/60 p-1 font-mono text-[10px] text-zinc-300">{JSON.stringify(tr!.weights, null, 1)}</pre>
                </div>
                <div>
                  <p className="text-[9px] uppercase text-zinc-500">explanation validation</p>
                  <ul>
                    {tr!.validation.map((v) => (
                      <li key={v.name}>
                        <Badge tone={v.passed ? "ok" : "error"}>{v.passed ? "pass" : "fail"}</Badge> {humanize(v.name)} <span className="text-zinc-500">{v.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </LabCard>
  );
}
