"use client";

import { useEffect, useMemo, useState } from "react";
import { EngineProvider, useEngine, useEngineState } from "@/hooks/useEngine";
import { CameraView } from "@/components/CameraView/CameraView";
import { CameraPicker } from "@/components/CameraView/CameraPicker";
import { MIRROR_LAYERS } from "@/components/FaceOverlay/drawOverlay";
import { ChatAssistant } from "@/components/ChatAssistant/ChatAssistant";
import { SiteNav } from "@/components/SiteNav";
import { CameraActiveIndicator, ConsentToggle } from "@/components/Mirror/CameraControls";
import { AgeOptIn } from "@/components/Age/AgeOptIn";
import { api } from "@/lib/api";
import type { CatalogStatus } from "@/lib/catalog";
import { COMPARE_MAX, toggleCompare } from "@/lib/beauty";
import { chipRequest, chipsFromObservations, QUICK_CHIPS } from "@/lib/suggest";
import { regionLabel } from "@/lib/format";
import { TierBadge } from "@/components/ui";
import { ARControls, ARLayer, DEFAULT_AR, type ARSettings } from "./ARPreview";
import { CatalogBanner } from "./CatalogBanner";
import { CompareTable } from "./CompareTable";
import { ProductCard } from "./ProductCard";
import { DEFAULT_FORM, RecommendationForm, type FormRequest } from "./RecommendationForm";

const FEATURE_TEXT: Record<string, string> = {
  visible_dryness: "dry-looking",
  visible_flaking: "dry or flaky-looking",
  visible_redness: "some redness",
  visible_blemishes: "some spots",
  visible_shine: "some shine",
  visible_darkness: "darker-looking under-eye area",
};

function QualifiedObservations({ selected, onToggle }: { selected: string[]; onToggle: (key: string) => void }) {
  const { latestResult, settings } = useEngineState();
  const obs = (latestResult?.observations.observations ?? []).filter((o) => o.status === "accepted" && o.present);
  if (!settings.consentUpload) return <p className="text-sm text-slate-500">Turn on analysis to optionally use what the mirror notices. You can also just pick a concern.</p>;
  if (!obs.length) return <p className="text-sm text-slate-500">Nothing confidently noticed right now — that&apos;s fine; choose what you&apos;d like below.</p>;
  return (
    <fieldset className="space-y-1 rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Optional: use an observation</legend>
      {obs.map((o) => {
        const key = `${o.region}:${o.feature}`;
        return (
          <label key={key} className="flex items-start gap-2">
            <input type="checkbox" checked={selected.includes(key)} onChange={() => onToggle(key)} className="mt-1 h-4 w-4" />
            <span>
              {regionLabel(o.region)}: {FEATURE_TEXT[o.feature] ?? o.feature.replace(/_/g, " ")}
              <TierBadge tier={o.model_tier} />
            </span>
          </label>
        );
      })}
      <p className="text-xs text-slate-500">Unticked by default. Observations only add search terms — they are not diagnoses.</p>
    </fieldset>
  );
}

function BeautyInner() {
  const engine = useEngine();
  const { camera, settings, recommendation, chatProductIds, latestResult, chat } = useEngineState();
  const [form, setForm] = useState<FormRequest>(DEFAULT_FORM);
  const [includeObs, setIncludeObs] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareMsg, setCompareMsg] = useState<string | null>(null);
  const [ar, setAr] = useState<ARSettings>(DEFAULT_AR);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    api
      .catalogStatus()
      .then(setStatus)
      .catch((e) => setStatusErr(String(e.message ?? e)));
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const res = recommendation.response;
  const explanations = useMemo(() => new Map((res?.explanations?.products ?? []).map((e) => [e.product_id, e.explanation])), [res]);
  const compared = (res?.results ?? []).filter((r) => compare.includes(r.product.product_id)).map((r) => r.product);

  const search = () => {
    setCompare([]);
    void engine.recommend({ ...form, include_observations: includeObs });
  };

  const noticed = chipsFromObservations(latestResult?.observations.observations);
  const chips = [...noticed, ...QUICK_CHIPS.filter((q) => !noticed.some((n) => n.concern === q.concern))];
  const [query, setQuery] = useState("");
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const ask = (text: string) => {
    if (!text.trim()) return;
    setCompare([]);
    setActiveChip(null);
    void engine.sendChat(text, { productSearch: true });
    setQuery("");
  };

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <SiteNav current="/beauty" />
        <CameraActiveIndicator />
      </header>
      <main id="main" className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-5 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-label="Find products" className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <h1 className="text-2xl font-semibold text-slate-900">What are you looking for?</h1>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask(query);
              }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. fragrance-free moisturiser under $25"
                aria-label="Describe the product you want"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-base"
              />
              <button type="submit" disabled={chat.pending || !query.trim()} className="rounded-xl bg-sky-700 px-5 py-2.5 font-medium text-white disabled:opacity-40">
                {chat.pending ? "…" : "Search"}
              </button>
            </form>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={activeChip === c.key}
                  onClick={() => {
                    setActiveChip(c.key);
                    setCompare([]);
                    void engine.recommend({ ...chipRequest(c, { fragranceFree: form.fragrance_free ?? false, budget: form.budget_max ?? null }), limit: 8 });
                  }}
                  className={`rounded-full border px-3 py-1.5 text-sm ${activeChip === c.key ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-sky-400"}`}
                  title={c.fromObservation ? "Based on what the mirror noticed in this image" : undefined}
                >
                  {c.fromObservation && <span aria-hidden>👁 </span>}
                  {c.label}
                </button>
              ))}
            </div>
            <details className="rounded-xl bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Refine — budget, ingredients, finish, coverage, shade…</summary>
              <div className="pt-3">
                <RecommendationForm value={form} onChange={setForm} onSubmit={search} pending={recommendation.pending} />
              </div>
            </details>
          </div>

          <CatalogBanner status={status} error={statusErr} />
          {recommendation.pending && <p className="text-sm text-slate-500">Finding products…</p>}
          {recommendation.error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">{recommendation.error}</p>}
          {!res && !recommendation.pending && <p className="text-sm text-slate-500">Type what you want or tap a quick pick — results appear here.</p>}
          {res && (
            <>
              <p className="text-sm text-slate-700">{res.explanations?.summary}</p>
              {res.trace.age_used && <p className="text-xs text-slate-500">{res.trace.age_note}</p>}
              {compareMsg && <p className="text-xs text-amber-800">{compareMsg}</p>}
              <CompareTable products={compared} onRemove={(id) => setCompare((c) => c.filter((x) => x !== id))} />
              {res.results.length === 0 && (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
                  No listings matched. {res.trace.filtered_out.length ? `${res.trace.filtered_out.length} were filtered out by your preferences.` : "Try a broader search."}
                </p>
              )}
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2">
                {res.results.map((r) => (
                  <ProductCard
                    key={r.product.product_id}
                    ranked={r}
                    now={now}
                    explanation={explanations.get(r.product.product_id)}
                    comparing={compare.includes(r.product.product_id)}
                    compareFull={compare.length >= COMPARE_MAX}
                    discussing={chatProductIds.includes(r.product.product_id)}
                    onCompare={() => {
                      const t = toggleCompare(compare, r.product.product_id);
                      setCompare(t.ids);
                      setCompareMsg(t.rejected ? `You can compare up to ${COMPARE_MAX} products.` : null);
                    }}
                    onDiscuss={() => {
                      const id = r.product.product_id;
                      engine.setChatProducts(chatProductIds.includes(id) ? chatProductIds.filter((x) => x !== id) : [...chatProductIds, id]);
                    }}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-500">{res.disclaimer} Purchases happen on eCosmetics, not in this app.</p>
            </>
          )}

          <details className="rounded-2xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer font-medium text-slate-800">Use the camera (optional) — observations, apparent age, lip-colour preview</summary>
            <div className="mt-3 space-y-3">
              <div className="aspect-[4/3] max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-slate-200">
                <CameraView layers={MIRROR_LAYERS} mirrored={settings.mirrored} fit="cover" dark={false}>
                  <ARLayer value={ar} fit="cover" mirrored={settings.mirrored} />
                </CameraView>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {camera !== "on" ? (
                  <button type="button" onClick={() => engine.startCamera()} disabled={camera === "starting"} className="rounded-lg bg-sky-700 px-4 py-2 font-medium text-white disabled:opacity-50">
                    {camera === "starting" ? "Starting…" : "Start camera"}
                  </button>
                ) : (
                  <button type="button" onClick={() => engine.stopCamera()} className="rounded-lg bg-rose-700 px-4 py-2 font-medium text-white">
                    Stop camera
                  </button>
                )}
              </div>
              <CameraPicker />
              <ConsentToggle />
              <QualifiedObservations selected={includeObs} onToggle={(k) => setIncludeObs((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))} />
              <AgeOptIn />
              <ARControls value={ar} onChange={setAr} faceTracked={camera === "on"} />
            </div>
          </details>
        </section>

        <section aria-label="Assistant" className="flex min-h-[28rem] flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:sticky lg:top-4 lg:h-[calc(100dvh-6rem)]">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Assistant</h2>
          <p className="mb-2 text-xs text-slate-500">
            Ask for products in your own words, or about ingredients and the items you tick “Ask the assistant” on
            {chatProductIds.length ? ` (${chatProductIds.length} selected)` : ""}.
          </p>
          <div className="min-h-0 flex-1">
            <ChatAssistant variant="light" />
          </div>
        </section>
      </main>
    </div>
  );
}

export function BeautyApp() {
  return (
    <EngineProvider mode="mirror" initial={{ inferenceHz: 2, returnInputs: false }}>
      <BeautyInner />
    </EngineProvider>
  );
}
