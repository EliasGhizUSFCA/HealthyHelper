"use client";

import Link from "next/link";
import { useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { api, getHistoryId } from "@/lib/api";

export const CONSENT_TEXT_VERSION = "2026-11-v1";

export function SnapshotButton() {
  const engine = useEngine();
  const { camera, landmarker, socket } = useEngineState();
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const snap = engine.captureSnapshot();
      if (!snap) throw new Error("Need exactly one clearly visible face to save a snapshot.");
      const historyId = getHistoryId(true);
      if (!historyId) throw new Error("Browser storage is unavailable.");
      const r = await api.createSnapshot({
        history_id: historyId,
        image_b64: snap.image,
        landmarks: snap.landmarks,
        consent_store_images: true,
        consent_text_version: CONSENT_TEXT_VERSION,
        session_id: socket.sessionId,
      });
      setStatus(`Saved snapshot ${r.snapshot_id.slice(0, 8)}.`);
      setOpen(false);
      setAgree(false);
    } catch (e) {
      setStatus(`Could not save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" disabled={camera !== "on" || landmarker !== "ready"} onClick={() => setOpen(true)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40">
        Save snapshot for comparison…
      </button>
      {status && (
        <p role="status" className="mt-1 text-sm text-slate-600">
          {status} <Link href="/history" className="text-sky-700 underline">View comparisons</Link>
        </p>
      )}
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="consent-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="consent-title" className="text-xl font-semibold text-slate-900">Store a snapshot?</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>One frame will be uploaded. The server aligns your face and stores <strong>cropped region images</strong> (lips, eyes, nose, skin) plus their observations.</li>
              <li>They are linked only to a random ID stored in this browser — not to your name or account.</li>
              <li>They are used only to show you side-by-side comparisons. They are never used to train models.</li>
              <li>You can delete everything at any time from the Comparisons or Privacy page.</li>
            </ul>
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-800">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-sky-700" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I understand and consent to storing these images for comparison.
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
                Cancel
              </button>
              <button type="button" disabled={!agree || busy} onClick={save} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                {busy ? "Saving…" : "Save snapshot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
