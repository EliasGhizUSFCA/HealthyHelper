"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SiteNav } from "@/components/SiteNav";
import { api, ApiError, getAnnotatorId, setAnnotatorId } from "@/lib/api";
import { useClientValue } from "@/hooks/useClientValue";
import { ANNOTATION_GUIDE } from "@/lib/annotationGuide";
import { regionLabel } from "@/lib/format";
import type { DatasetExport, DatasetLabelValue, DatasetModelStats, DatasetSample, ModelInfo } from "@/lib/protocol";

/** Readiness thresholds — mirror backend/training/train.py (minimum to train, validation gate). */
export function readiness(s: DatasetModelStats) {
  return [
    { name: "≥ 10 usable images of each class (to train at all)", ok: s.positive >= 10 && s.negative >= 10, value: `${s.positive} / ${s.negative}` },
    { name: "≥ 3 different people (subject-grouped split)", ok: s.subjects >= 3, value: `${s.subjects}` },
    { name: "≥ 2 annotators with agreement κ ≥ 0.6 (validation gate)", ok: s.mean_kappa != null && s.mean_kappa >= 0.6, value: s.mean_kappa == null ? "n/a" : s.mean_kappa.toFixed(2) },
    { name: "≈ 100+ subjects for a validated model (≥15 in the test split)", ok: s.subjects >= 100, value: `${s.subjects}` },
  ];
}

export function LabelApp() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("lip_dryness");
  const storedAnnotator = useClientValue(() => getAnnotatorId() ?? "", "");
  const [annotatorEdit, setAnnotator] = useState<string | null>(null);
  const annotator = annotatorEdit ?? storedAnnotator;
  const [samples, setSamples] = useState<DatasetSample[]>([]);
  const [onlyUnlabelled, setOnlyUnlabelled] = useState(true);
  const [idx, setIdx] = useState(0);
  const [stats, setStats] = useState<DatasetModelStats[]>([]);
  const [exported, setExported] = useState<DatasetExport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.models().then(setModels).catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, []);

  const load = useCallback(
    () =>
      Promise.all([api.datasetSamples({ model_id: modelId, limit: 5000 }), api.datasetStats()])
        .then(([s, st]) => {
          setSamples(s);
          setStats(st);
          setErr(null);
        })
        .catch((e) => setErr(e instanceof ApiError ? e.message : String(e))),
    [modelId],
  );
  useEffect(() => {
    Promise.all([api.datasetSamples({ model_id: modelId, limit: 5000 }), api.datasetStats()])
      .then(([s, st]) => {
        setSamples(s);
        setStats(st);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [modelId]);

  const mineFor = useCallback((s: DatasetSample) => s.labels.find((l) => l.model_id === modelId && l.annotator_id === annotator)?.label, [modelId, annotator]);
  const queue = useMemo(() => (onlyUnlabelled ? samples.filter((s) => !mineFor(s)) : samples), [samples, onlyUnlabelled, mineFor]);
  const current = queue[Math.min(idx, Math.max(0, queue.length - 1))];
  const guide = ANNOTATION_GUIDE[modelId];
  const st = stats.find((s) => s.model_id === modelId);

  const label = useCallback(
    async (value: DatasetLabelValue) => {
      if (!current || !annotator) return;
      try {
        await api.datasetLabel(current.sample_id, { model_id: modelId, annotator_id: annotator, label: value });
        setSamples((prev) => prev.map((s) => (s.sample_id === current.sample_id
          ? { ...s, labels: [...s.labels.filter((l) => !(l.model_id === modelId && l.annotator_id === annotator)), { model_id: modelId, annotator_id: annotator, label: value }] }
          : s)));
        if (!onlyUnlabelled) setIdx((i) => Math.min(i + 1, queue.length - 1));
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : String(e));
      }
    },
    [current, annotator, modelId, onlyUnlabelled, queue.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "1") void label("positive");
      else if (e.key === "2") void label("negative");
      else if (e.key === "3") void label("cannot_judge");
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(queue.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [label, queue.length]);

  async function doExport() {
    try {
      setExported(await api.datasetExport(modelId));
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }

  const options = models.length ? models.map((m) => m.model_id) : Object.keys(ANNOTATION_GUIDE);
  const mine = current ? mineFor(current) : undefined;
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <SiteNav current="/label" />
      </header>
      <main id="main" className="mx-auto max-w-6xl space-y-6 px-6 pb-16">
        <h1 className="text-3xl font-semibold text-slate-900">Label training data</h1>
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <label className="flex flex-col gap-1 text-slate-700">
            Feature to label
            <select value={modelId} onChange={(e) => { setModelId(e.target.value); setIdx(0); setExported(null); }} className="rounded border border-slate-300 px-2 py-1.5">
              {options.map((m) => <option key={m} value={m}>{ANNOTATION_GUIDE[m]?.title ?? m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-slate-700">
            Annotator ID
            <input value={annotator} onChange={(e) => { const v = e.target.value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32); setAnnotator(v); if (v.length >= 4) setAnnotatorId(v); }}
              className="w-48 rounded border border-slate-300 px-2 py-1.5 font-mono" />
          </label>
          <label className="flex items-center gap-2 text-slate-700">
            <input type="checkbox" checked={onlyUnlabelled} onChange={(e) => { setOnlyUnlabelled(e.target.checked); setIdx(0); }} className="h-4 w-4" />
            Only crops I haven&apos;t labelled
          </label>
          <span className="ml-auto text-slate-500">{queue.length} in queue · {samples.length} crops for this feature</span>
        </div>
        {err && <p role="alert" className="rounded-lg bg-rose-50 px-4 py-2 text-rose-900">{err}</p>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            {!current ? (
              <p className="text-slate-600">
                {samples.length === 0 ? <>No crops for this feature yet — capture some on the <a href="/collect" className="text-sky-700 underline">Collect</a> page.</> : "All crops labelled. 🎉"}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm text-slate-500">
                  <span>{regionLabel(current.region)} · {current.metadata.lighting ?? "unknown light"} · {current.width}×{current.height}px</span>
                  <span>{Math.min(idx, queue.length - 1) + 1} / {queue.length}</span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={api.datasetImageUrl(current.sample_id)} alt={`Crop of ${regionLabel(current.region)}`} className="mx-auto aspect-square w-full max-w-md rounded-lg object-contain [image-rendering:auto] bg-slate-100" />
                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={() => label("positive")} className={`rounded-lg px-3 py-3 font-medium ${mine === "positive" ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-950 hover:bg-amber-200"}`}>1 · {guide?.positive ?? "Visible"}</button>
                  <button type="button" onClick={() => label("negative")} className={`rounded-lg px-3 py-3 font-medium ${mine === "negative" ? "bg-emerald-700 text-white" : "bg-emerald-100 text-emerald-950 hover:bg-emerald-200"}`}>2 · {guide?.negative ?? "Not visible"}</button>
                  <button type="button" onClick={() => label("cannot_judge")} className={`rounded-lg px-3 py-3 font-medium ${mine === "cannot_judge" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-900 hover:bg-slate-200"}`}>3 · Can&apos;t judge</button>
                </div>
                <div className="flex justify-between text-sm">
                  <button type="button" onClick={() => setIdx((i) => Math.max(0, i - 1))} className="text-sky-700">← Previous</button>
                  <span className="text-slate-400">Keys: 1 / 2 / 3, ← →. Other annotators&apos; labels are hidden (blind labelling).</span>
                  <button type="button" onClick={() => setIdx((i) => Math.min(queue.length - 1, i + 1))} className="text-sky-700">Next →</button>
                </div>
              </>
            )}
          </section>

          <section className="space-y-4">
            {guide && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h2 className="font-semibold text-slate-900">How to label: {guide.title}</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {guide.criteria.map((c) => <li key={c}>{c}</li>)}
                  <li>Label what you see in the crop — appearance, never a diagnosis. When unsure, choose “Can&apos;t judge”.</li>
                </ul>
              </div>
            )}
            {st && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                <h2 className="font-semibold text-slate-900">Dataset for this feature</h2>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {[["usable", st.usable], ["visible", st.positive], ["not visible", st.negative], ["people", st.subjects], ["sessions", st.sessions], ["annotators", st.annotators.length]].map(([k, v]) => (
                    <div key={k} className="rounded bg-slate-50 p-2"><dt className="text-xs text-slate-500">{k}</dt><dd className="text-lg font-semibold text-slate-900">{v}</dd></div>
                  ))}
                </dl>
                <ul className="mt-3 space-y-1">
                  {readiness(st).map((r) => (
                    <li key={r.name} className="flex justify-between gap-2"><span>{r.ok ? "✅" : "⬜"} {r.name}</span><span className="font-mono text-slate-500">{r.value}</span></li>
                  ))}
                </ul>
                <button type="button" onClick={doExport} disabled={st.usable === 0} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-40">
                  Export training manifest
                </button>
                {exported && (
                  <div className="mt-3 space-y-2">
                    <p className="text-slate-700">Exported {exported.rows} labelled crops. Train with:</p>
                    <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{exported.train_command}</pre>
                    <button type="button" onClick={() => navigator.clipboard?.writeText(exported.train_command)} className="text-sky-700">Copy command</button>
                    <p className="text-xs text-slate-500">Then restart the backend (or POST /api/models/reload). The new model is marked “experimental” in the app.</p>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
