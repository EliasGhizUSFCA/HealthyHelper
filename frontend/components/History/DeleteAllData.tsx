"use client";

import { useState } from "react";
import { api, forgetHistoryId, getHistoryId } from "@/lib/api";

export function DeleteAllData({ onDeleted }: { onDeleted?: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const del = async () => {
    const id = getHistoryId(false);
    if (!window.confirm("Delete all stored snapshots and forget this browser's history ID? This cannot be undone.")) return;
    setBusy(true);
    try {
      if (id) {
        const r = await api.deleteHistory(id);
        setStatus(`Deleted ${r.deleted_snapshots} snapshot(s) and ${r.deleted_files} file(s).`);
      } else setStatus("No stored history for this browser.");
      forgetHistoryId();
      onDeleted?.();
    } catch (e) {
      setStatus(`Deletion failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2">
      <p className="text-sm text-slate-600">Removes every consented snapshot linked to this browser from the server and clears the local pseudonymous ID.</p>
      <button type="button" disabled={busy} onClick={del} className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-50">
        {busy ? "Deleting…" : "Delete all my stored data"}
      </button>
      {status && (
        <p role="status" className="mt-2 text-sm text-slate-700">
          {status}
        </p>
      )}
    </div>
  );
}
