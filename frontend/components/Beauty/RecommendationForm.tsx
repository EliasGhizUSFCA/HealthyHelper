"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CONCERNS, type CatalogCategory, type RecommendationRequest } from "@/lib/catalog";
import { cx } from "@/components/ui";

export type FormRequest = Omit<RecommendationRequest, "confirmed_age_range" | "session_id">;

export const DEFAULT_FORM: FormRequest = {
  mode: "skincare",
  concern: "dry_lips",
  categories: [],
  query: "",
  include_observations: [],
  budget_max: null,
  fragrance_free: false,
  exclude_ingredients: [],
  strict_ingredient_check: false,
  finish: null,
  coverage: null,
  shade: null,
  undertone: null,
  brands: [],
  in_stock_only: false,
  limit: 8,
  explain: true,
};

/** Shared preference form (Beauty page + Model Lab ranking tab). All inputs are user-provided. */
export function RecommendationForm({
  value,
  onChange,
  onSubmit,
  pending,
  dark = false,
}: {
  value: FormRequest;
  onChange: (v: FormRequest) => void;
  onSubmit: () => void;
  pending: boolean;
  dark?: boolean;
}) {
  const [cats, setCats] = useState<CatalogCategory[]>([]);
  const [excl, setExcl] = useState((value.exclude_ingredients ?? []).join(", "));
  useEffect(() => {
    api.catalogCategories().then(setCats).catch(() => setCats([]));
  }, []);
  const set = (p: Partial<FormRequest>) => onChange({ ...value, ...p });
  const input = cx("rounded border px-2 py-1", dark ? "border-zinc-700 bg-zinc-900 text-[11px] text-zinc-200" : "border-slate-300 bg-white text-sm");
  const lab = cx("flex flex-col gap-0.5", dark ? "text-[10px] text-zinc-400" : "text-xs text-slate-600");
  const makeup = value.mode === "makeup";
  return (
    <form
      className={cx("space-y-2", dark ? "text-[11px] text-zinc-300" : "text-sm text-slate-700")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div role="radiogroup" aria-label="Recommendation type" className="flex overflow-hidden rounded-lg border border-slate-300">
        {(["skincare", "makeup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value.mode === m}
            onClick={() => set({ mode: m, concern: CONCERNS.find((c) => c.mode === m)?.key ?? null, categories: [], finish: null, coverage: null, shade: null, undertone: null })}
            className={cx("flex-1 px-3 py-1 capitalize", value.mode === m ? (dark ? "bg-cyan-800 text-white" : "bg-sky-700 text-white") : dark ? "bg-zinc-900" : "bg-white")}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className={lab}>
          {makeup ? "What would you like?" : "What would you like help with?"}
          <select className={input} value={value.concern ?? ""} onChange={(e) => set({ concern: e.target.value || null })}>
            <option value="">(no specific concern)</option>
            {CONCERNS.filter((c) => c.mode === value.mode).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={lab}>
          Category
          <select className={input} value={value.categories?.[0] ?? ""} onChange={(e) => set({ categories: e.target.value ? [e.target.value] : [] })}>
            <option value="">(based on your choice)</option>
            {cats
              .filter((c) => c.mode === value.mode)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
        <label className={cx(lab, "col-span-2")}>
          Preferences in your own words
          <input className={input} maxLength={200} value={value.query ?? ""} onChange={(e) => set({ query: e.target.value })} placeholder={makeup ? "e.g. lightweight, natural finish" : "e.g. lightweight gel, no shine"} />
        </label>
        <label className={lab}>
          Max budget (USD)
          <input className={input} type="number" min={0} step={1} value={value.budget_max ?? ""} onChange={(e) => set({ budget_max: e.target.value === "" ? null : Number(e.target.value) })} />
        </label>
        <label className={lab}>
          Brand (optional)
          <input className={input} value={value.brands?.[0] ?? ""} onChange={(e) => set({ brands: e.target.value.trim() ? [e.target.value.trim()] : [] })} />
        </label>
        <label className={cx(lab, "col-span-2")}>
          Exclude ingredients (comma-separated)
          <input
            className={input}
            value={excl}
            onChange={(e) => {
              setExcl(e.target.value);
              set({ exclude_ingredients: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 20) });
            }}
            placeholder="e.g. alcohol denat, lanolin"
          />
        </label>
        {makeup && (
          <>
            <label className={lab}>
              Finish
              <select className={input} value={value.finish ?? ""} onChange={(e) => set({ finish: e.target.value || null })}>
                <option value="">any</option>
                {["matte", "natural", "satin", "dewy", "radiant"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className={lab}>
              Coverage
              <select className={input} value={value.coverage ?? ""} onChange={(e) => set({ coverage: e.target.value || null })}>
                <option value="">any</option>
                {["sheer", "light", "medium", "full", "buildable"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className={lab}>
              Shade name contains
              <input className={input} value={value.shade ?? ""} onChange={(e) => set({ shade: e.target.value || null })} placeholder="e.g. light, 120" />
            </label>
            <label className={lab}>
              Undertone
              <select className={input} value={value.undertone ?? ""} onChange={(e) => set({ undertone: (e.target.value || null) as FormRequest["undertone"] })}>
                <option value="">any</option>
                {["cool", "neutral", "warm", "olive"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={!!value.fragrance_free} onChange={(e) => set({ fragrance_free: e.target.checked })} /> Fragrance-free
        </label>
        <label className="flex items-center gap-1" title="Many listings have no ingredient list; tick to hide them when filtering by ingredients">
          <input type="checkbox" checked={!!value.strict_ingredient_check} onChange={(e) => set({ strict_ingredient_check: e.target.checked })} /> Only show products whose ingredients could be verified
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={!!value.in_stock_only} onChange={(e) => set({ in_stock_only: e.target.checked })} /> In stock only
        </label>
      </div>
      <button type="submit" disabled={pending} className={cx("w-full rounded-lg px-4 py-2 font-medium text-white disabled:opacity-50", dark ? "bg-cyan-800" : "bg-sky-700 hover:bg-sky-800")}>
        {pending ? "Searching the catalogue…" : "Find products"}
      </button>
    </form>
  );
}
