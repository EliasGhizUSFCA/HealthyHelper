"use client";

import { useCallback, useEffect, useState } from "react";
import { EngineProvider, useEngine, useEngineState } from "@/hooks/useEngine";
import { CameraView } from "@/components/CameraView/CameraView";
import { MIRROR_LAYERS } from "@/components/FaceOverlay/drawOverlay";
import { SiteNav } from "@/components/SiteNav";
import { CameraActiveIndicator } from "@/components/Mirror/CameraControls";
import { api, ApiError, forgetContributorId, getContributorId } from "@/lib/api";
import { useClientValue } from "@/hooks/useClientValue";
import { regionLabel } from "@/lib/format";
import type { DatasetSample } from "@/lib/protocol";

export const RESEARCH_CONSENT_VERSION = "research-v1";
const CONSENT_KEY = "ahm.research_consent";

const META_OPTIONS: Record<string, string[]> = {
  lighting: ["daylight", "indoor_warm", "indoor_cool", "dim", "mixed"],
  glasses: ["no", "yes"],
  makeup: ["none", "light", "heavy"],
};

function sessionId(): string {
  const d = new Date();
  return `sess-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}`;
}

function ConsentCard({ onConsent }: { onConsent: () => void }) {
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function agree() {
    setBusy(true);
    setErr(null);
    try {
      await api.datasetConsent({ contributor_id: getContributorId()!, consent_research: true, consent_text_version: RESEARCH_CONSENT_VERSION });
      localStorage.setItem(CONSENT_KEY, RESEARCH_CONSENT_VERSION);
      onConsent();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="max-w-3xl space-y-4 rounded-2xl border-2 border-sky-300 bg-white p-6">
      <h2 className="text-xl font-semibold text-slate-900">Contribute training images — separate consent</h2>
      <ul className="list-disc space-y-1.5 pl-5 text-slate-700">
        <li>Each capture saves small crops of your lips, eyes, under-eyes, nose and skin (no full-face photo) on the server running this app, so they can be labelled and used to <strong>train models</strong>.</li>
        <li>This is different from the Health Mirror, which never stores or trains on your images.</li>
        <li>Crops are linked only to a random ID stored in this browser — no name or email.</li>
        <li>Labels describe visible appearance (e.g. “visible spots”), not medical conditions.</li>
        <li>You can withdraw at any time on this page; that permanently deletes every crop and label you contributed. Models already trained on them are not automatically retrained — delete or retrain those models too.</li>
        <li>Only contribute your own face, or a face of someone who has agreed to this themselves.</li>
      </ul>
      <label className="flex items-start gap-3 text-slate-800">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-sky-700" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>I am the person in the images (or have their permission), I am 18 or older, and I agree that these crops may be stored and used to train models as described.</span>
      </label>
      <button type="button" disabled={!checked || busy} onClick={agree} className="rounded-lg bg-sky-700 px-5 py-2.5 font-medium text-white disabled:opacity-40">
        {busy ? "Saving…" : "I agree — start contributing"}
      </button>
      {err && <p role="alert" className="text-rose-700">{err}</p>}
    </section>
  );
}

function CollectInner() {
  const engine = useEngine();
  const { camera, cameraError } = useEngineState();
  const storedConsent = useClientValue(() => {
    try {
      return localStorage.getItem(CONSENT_KEY) === RESEARCH_CONSENT_VERSION && !!getContributorId(false);
    } catch {
      return false;
    }
  }, false);
  const [consentOverride, setConsented] = useState<boolean | null>(null);
  const consented = consentOverride ?? storedConsent;
  const [meta, setMeta] = useState<Record<string, string>>({ lighting: "indoor_warm", glasses: "no", makeup: "none" });
  const [device, setDevice] = useState("");
  const [skinTone, setSkinTone] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [mine, setMine] = useState<DatasetSample[]>([]);
  const [busy, setBusy] = useState(false);
  const contributor = useClientValue(() => getContributorId(false), null);

  const refresh = useCallback(() => {
    const id = getContributorId(false);
    if (!id) return Promise.resolve();
    return api
      .datasetSamples({ contributor_id: id, limit: 5000 })
      .then(setMine)
      .catch((e) => setStatus(e instanceof ApiError ? e.message : String(e)));
  }, []);
  useEffect(() => {
    if (!consented) return;
    const id = getContributorId(false);
    if (!id) return;
    api
      .datasetSamples({ contributor_id: id, limit: 5000 })
      .then(setMine)
      .catch((e) => setStatus(e instanceof ApiError ? e.message : String(e)));
  }, [consented]);

  async function capture() {
    const r = engine.captureRegionCrops(256);
    if ("error" in r) {
      setStatus(r.error);
      return;
    }
    setBusy(true);
    try {
      const metadata: Record<string, string> = { ...meta };
      if (device.trim()) metadata.device = device.trim().slice(0, 40);
      if (skinTone) metadata.skin_tone = skinTone;
      const saved = await api.datasetAdd({
        contributor_id: getContributorId()!, session_id: sessionId(), quality: r.quality, metadata,
        crops: r.crops.map((c) => ({ region: c.region, image_b64: c.dataUrl })),
      });
      setStatus(`Saved ${saved.length} region crops${r.quality.status === "poor" ? ` (quality: poor — ${r.quality.issues.join(", ")})` : ""}.`);
      await refresh();
    } catch (e) {
      setStatus(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    const id = getContributorId(false);
    if (!id || !window.confirm("Permanently delete every crop and label you contributed?")) return;
    try {
      const rep = await api.datasetWithdraw(id);
      forgetContributorId();
      setConsented(false);
      setMine([]);
      setStatus(`Withdrawn. Deleted ${rep.deleted_snapshots} crop(s) and ${rep.deleted_files} file(s).`);
    } catch (e) {
      setStatus(e instanceof ApiError ? e.message : String(e));
    }
  }

  const captures = new Set(mine.map((s) => s.created_at.toFixed(0).slice(0, -3))).size;
  return (
    <div className="min-h-full">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <SiteNav current="/collect" />
        <CameraActiveIndicator />
      </header>
      <main id="main" className="mx-auto max-w-6xl space-y-6 px-6 pb-16">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Collect real training data</h1>
          <p className="mt-1 max-w-3xl text-slate-600">
            Capture crops of your face under different conditions, then label them on the <a className="text-sky-700 underline" href="/label">Label</a> page.
            Variety matters more than volume: different days, rooms, lighting, with and without glasses or makeup — and ideally several different people.
          </p>
        </div>
        {!consented ? (
          <ConsentCard onConsent={() => setConsented(true)} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <section className="space-y-4">
              <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-slate-200 bg-slate-200">
                <CameraView layers={{ ...MIRROR_LAYERS, eyes: true, lips: true, nose: true, skin: true, undereye: true }} mirrored fit="cover" dark={false} />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {camera !== "on" ? (
                  <button type="button" onClick={() => engine.startCamera()} disabled={camera === "starting"} className="rounded-lg bg-sky-700 px-5 py-2.5 font-medium text-white disabled:opacity-50">
                    {camera === "starting" ? "Starting…" : "Start camera"}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={capture} disabled={busy} className="rounded-lg bg-emerald-700 px-5 py-2.5 font-medium text-white disabled:opacity-50">
                      {busy ? "Saving…" : "Capture"}
                    </button>
                    <button type="button" onClick={() => engine.stopCamera()} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-800">
                      Stop camera
                    </button>
                  </>
                )}
              </div>
              {cameraError && <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-rose-900">{cameraError.message}</p>}
              {status && <p role="status" className="rounded-lg bg-slate-100 px-4 py-2 text-slate-800">{status}</p>}
            </section>
            <section className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h2 className="font-semibold text-slate-900">Capture conditions (optional, self-reported)</h2>
                <p className="text-sm text-slate-500">Used to break down evaluation results, e.g. accuracy in dim light.</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {Object.entries(META_OPTIONS).map(([k, opts]) => (
                    <label key={k} className="flex flex-col gap-1 capitalize text-slate-700">
                      {k}
                      <select value={meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} className="rounded border border-slate-300 px-2 py-1.5">
                        {opts.map((o) => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
                      </select>
                    </label>
                  ))}
                  <label className="flex flex-col gap-1 text-slate-700">
                    Skin tone (Monk scale, optional)
                    <select value={skinTone} onChange={(e) => setSkinTone(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5">
                      <option value="">prefer not to say</option>
                      {Array.from({ length: 10 }, (_, i) => <option key={i} value={`mst_${i + 1}`}>MST {i + 1}</option>)}
                    </select>
                  </label>
                  <label className="col-span-2 flex flex-col gap-1 text-slate-700">
                    Camera / device (optional)
                    <input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="e.g. MacBook built-in" className="rounded border border-slate-300 px-2 py-1.5" />
                  </label>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-900">Your contributions</h2>
                  <span className="text-sm text-slate-500">{mine.length} crops · ~{captures} captures</span>
                </div>
                <div className="mt-3 grid max-h-72 grid-cols-6 gap-1.5 overflow-auto">
                  {mine.slice(-60).reverse().map((s) => (
                    <figure key={s.sample_id} className="group relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={api.datasetImageUrl(s.sample_id)} alt={regionLabel(s.region)} className="aspect-square w-full rounded object-cover" />
                      <button type="button" title="Delete this crop" onClick={async () => { await api.datasetDeleteSample(s.sample_id); await refresh(); }}
                        className="absolute right-0.5 top-0.5 hidden rounded bg-black/70 px-1 text-xs text-white group-hover:block">✕</button>
                    </figure>
                  ))}
                </div>
                <p className="mt-2 break-all text-xs text-slate-400">Contributor ID (this browser only): {contributor}</p>
                <button type="button" onClick={withdraw} className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-sm font-medium text-white">
                  Withdraw consent &amp; delete all my contributions
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

export function CollectApp() {
  return (
    <EngineProvider mode="mirror" initial={{ inferenceHz: 0.5, returnInputs: false }}>
      <CollectInner />
    </EngineProvider>
  );
}
