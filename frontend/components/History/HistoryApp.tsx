"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SiteNav } from "@/components/SiteNav";
import { api, getHistoryId } from "@/lib/api";
import { featureLabel, regionLabel } from "@/lib/format";
import type { ComparisonResult, Observation, SnapshotSummary } from "@/lib/protocol";
import { DeleteAllData } from "./DeleteAllData";

const LINE_COLORS = ["#0369a1", "#be185d", "#a16207", "#15803d", "#7c3aed", "#0f766e", "#b91c1c"];

function obsText(o: Observation | null) {
  if (!o) return "—";
  if (o.status !== "accepted") return o.status;
  return o.present ? `${featureLabel(o.feature)} flagged` : `no clear ${featureLabel(o.feature)}`;
}

export function HistoryApp() {
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<SnapshotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [cmp, setCmp] = useState<ComparisonResult | null>(null);
  const [loadingCmp, setLoadingCmp] = useState(false);

  const load = useCallback(async () => {
    const id = getHistoryId(false);
    setHistoryId(id);
    if (!id) {
      setSnaps([]);
      return;
    }
    try {
      const list = await api.listSnapshots(id);
      setSnaps(list);
      setError(null);
      if (list.length >= 2) {
        setBefore(list[0].snapshot_id);
        setAfter(list[list.length - 1].snapshot_id);
      }
    } catch (e) {
      setError((e as Error).message);
      setSnaps([]);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; state is set asynchronously after the request resolves.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const compare = async () => {
    if (!historyId || !before || !after || before === after) return;
    setLoadingCmp(true);
    try {
      setCmp(await api.compare(historyId, before, after));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingCmp(false);
    }
  };

  const chart = useMemo(() => {
    if (!snaps) return { data: [], keys: [] as string[] };
    const keys = new Set<string>();
    const data = snaps.map((s) => {
      const row: Record<string, number | string | null> = { t: new Date(s.created_at).toLocaleDateString() + " " + new Date(s.created_at).toLocaleTimeString() };
      for (const o of s.observations) {
        const k = `${regionLabel(o.region)} · ${featureLabel(o.feature)}`;
        keys.add(k);
        row[k] = o.confidence;
      }
      return row;
    });
    return { data, keys: [...keys] };
  }, [snaps]);

  const demo = snaps?.some((s) => s.observations.some((o) => o.model_tier === "demo"));

  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <SiteNav current="/history" />
      </header>
      <main id="main" className="mx-auto max-w-6xl space-y-6 px-6 pb-16">
        <h1 className="text-3xl font-semibold text-slate-900">Session comparisons</h1>
        <div role="note" className="rounded-xl border-2 border-amber-300 bg-amber-50 px-5 py-4 text-amber-950">
          <p className="font-semibold">Visual differences are not medical improvement or deterioration.</p>
          <p className="text-sm">Lighting, camera, angle, makeup and expression change how a face looks between sessions. These comparisons show pixels and classifier scores, nothing more.</p>
        </div>
        {demo && (
          <div className="rounded-xl border-2 border-fuchsia-500 bg-fuchsia-50 px-5 py-3 text-fuchsia-950">
            <p className="font-semibold">Demonstration models – trained on synthetic data, not real observations.</p>
          </div>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 px-4 py-2 text-rose-800">
            {error}
          </p>
        )}
        {snaps === null ? (
          <p className="text-slate-600">Loading…</p>
        ) : snaps.length === 0 ? (
          <p className="text-slate-600">
            No stored snapshots for this browser. Save one from the <Link href="/mirror" className="text-sky-700 underline">Health Mirror</Link> (requires separate consent).
          </p>
        ) : (
          <>
            <section aria-label="Snapshots" className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-900">Your snapshots ({snaps.length})</h2>
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {snaps.map((s) => (
                  <li key={s.snapshot_id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="font-mono text-slate-500">{s.snapshot_id.slice(0, 8)}</span>
                    <span>{new Date(s.created_at).toLocaleString()}</span>
                    <span className="text-slate-500">quality: {s.quality.status}</span>
                    <span className="text-slate-500">lightness L* {s.lighting.mean_L?.toFixed(0) ?? "—"}</span>
                  </li>
                ))}
              </ul>
              {snaps.length >= 2 && (
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="block text-slate-600">Before</span>
                    <select value={before} onChange={(e) => setBefore(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5">
                      {snaps.map((s) => (
                        <option key={s.snapshot_id} value={s.snapshot_id}>
                          {new Date(s.created_at).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="block text-slate-600">After</span>
                    <select value={after} onChange={(e) => setAfter(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5">
                      {snaps.map((s) => (
                        <option key={s.snapshot_id} value={s.snapshot_id}>
                          {new Date(s.created_at).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => void compare()} disabled={before === after || loadingCmp} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                    {loadingCmp ? "Comparing…" : "Compare"}
                  </button>
                </div>
              )}
            </section>
            {chart.keys.length > 0 && (
              <section aria-label="Change over time" className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-lg font-semibold text-slate-900">Classifier scores over time</h2>
                <p className="text-sm text-slate-500">Positive-class classifier scores per snapshot. Not a health trend.</p>
                <div className="mt-3 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chart.data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                      <CartesianGrid stroke="#e2e8f0" />
                      <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {chart.keys.map((k, i) => (
                        <Line key={k} dataKey={k} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} connectNulls isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}
            {cmp && (
              <section aria-label="Comparison" className="space-y-3">
                <h2 className="text-lg font-semibold text-slate-900">Side-by-side</h2>
                {cmp.caveats.map((c) => (
                  <p key={c} className="text-sm text-slate-600">
                    • {c}
                  </p>
                ))}
                <div className="grid gap-4 md:grid-cols-2">
                  {cmp.regions.map((r) => (
                    <article key={r.region} className="rounded-xl border border-slate-200 bg-white p-4">
                      <header className="flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900">{regionLabel(r.region)}</h3>
                        <span className={`rounded px-2 py-0.5 text-xs ${r.lighting_comparable ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                          {r.lighting_comparable ? "lighting comparable" : `lighting differs (Δ${r.lighting_delta.toFixed(0)})`}
                        </span>
                      </header>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {[
                          [r.before_b64, "Before"],
                          [r.after_b64, "After"],
                          [r.diff_b64, "Pixel difference"],
                        ].map(([src, label]) => (
                          <figure key={label}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={`${regionLabel(r.region)} ${label}`} className="aspect-square w-full rounded border border-slate-200 object-cover" />
                            <figcaption className="mt-0.5 text-center text-xs text-slate-500">{label}</figcaption>
                          </figure>
                        ))}
                      </div>
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                        <dt className="text-slate-500">Mean pixel difference</dt>
                        <dd>{r.mean_abs_diff.toFixed(1)} / 255</dd>
                        <dt className="text-slate-500">Before</dt>
                        <dd>{obsText(r.before_observation)}</dd>
                        <dt className="text-slate-500">After</dt>
                        <dd>{obsText(r.after_observation)}</dd>
                      </dl>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">Delete all stored data</h2>
          <DeleteAllData
            onDeleted={() => {
              setSnaps([]);
              setCmp(null);
              setHistoryId(null);
            }}
          />
        </section>
      </main>
    </div>
  );
}
