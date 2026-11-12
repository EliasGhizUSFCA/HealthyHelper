"use client";

import { useEngineState } from "@/hooks/useEngine";
import { Badge, Empty, LabCard, statusTone } from "@/components/ui";
import { fmt, regionLabel } from "@/lib/format";
import { StaleNotice } from "@/components/StaleNotice";

export function InputInspector() {
  const { latestResult, latestReceivedAt, frozen, models, settings } = useEngineState();
  const result = frozen?.result ?? latestResult;
  const synthetic = settings.source === "synthetic";
  const unloaded = models.filter((m) => m.tier === "unavailable");
  return (
    <LabCard id="p2" title="P2 · Model input inspector" subtitle="Raw received crop vs. the exact de-normalised tensor each classifier consumed">
      {!settings.returnInputs && <p className="mb-2 text-[11px] text-amber-300">Input previews are off (toolbar → “Inputs”). Tensor stats are still shown.</p>}
      {unloaded.length > 0 && (
        <div className="mb-2 space-y-1">
          {unloaded.map((m) => (
            <div key={m.model_id} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-400">
              <Badge tone="skip">not loaded</Badge> <span className="font-mono text-zinc-300">{m.model_id}</span> — {m.status_message}
            </div>
          ))}
        </div>
      )}
      {!frozen && <StaleNotice completedAt={latestReceivedAt} dark />}
      {!result ? (
        <Empty>No inference result yet. Start the camera (or synthetic input), enable upload consent, and wait for the sampler.</Empty>
      ) : (
        <div className="space-y-2">
          {result.predictions.map((p) => (
            <article key={`${p.model_id}:${p.region}`} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
              <header className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-zinc-100">{p.model_id}</span>
                <span className="font-mono text-[10px] text-zinc-500">v{p.model_version}</span>
                <Badge tone={statusTone(p.model_tier)}>{p.model_tier}</Badge>
                <Badge tone="info">{regionLabel(p.region)}</Badge>
                {synthetic && <Badge tone="violet">simulated input</Badge>}
                <span className="ml-auto font-mono text-[10px] text-zinc-500">frame #{result.frame_id}</span>
              </header>
              {p.model_tier === "unavailable" || !p.input ? (
                <p className="text-[11px] text-zinc-500">Model not loaded — no tensor was produced. ({p.decision_reason})</p>
              ) : (
                <div className="flex gap-3">
                  <figure className="shrink-0">
                    <figcaption className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-500">Raw crop (camera pixels)</figcaption>
                    {p.input.raw_preview_b64 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.input.raw_preview_b64} alt={`Raw ${p.region} crop`} className="h-24 w-24 rounded border border-zinc-700 object-contain [image-rendering:pixelated]" />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded border border-dashed border-zinc-800 text-[9px] text-zinc-600">off</div>
                    )}
                    <div className="mt-0.5 font-mono text-[9px] text-zinc-500">
                      {p.input.raw_size[0]}×{p.input.raw_size[1]} px
                    </div>
                  </figure>
                  <figure className="shrink-0">
                    <figcaption className="mb-0.5 text-[9px] uppercase tracking-wider text-cyan-500">Model tensor (de-normalised)</figcaption>
                    {p.input.tensor_preview_b64 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.input.tensor_preview_b64} alt={`Preprocessed ${p.region} tensor`} className="h-24 w-24 rounded border border-cyan-800 object-contain [image-rendering:pixelated]" />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded border border-dashed border-zinc-800 text-[9px] text-zinc-600">off</div>
                    )}
                    <div className="mt-0.5 font-mono text-[9px] text-zinc-500">[{p.input.tensor.shape.join("×")}]</div>
                  </figure>
                  <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px]">
                    <dt className="text-zinc-500">shape</dt>
                    <dd className="text-zinc-200">[{p.input.tensor.shape.join(", ")}]</dd>
                    <dt className="text-zinc-500">dtype</dt>
                    <dd className="text-zinc-200">{p.input.tensor.dtype}</dd>
                    <dt className="text-zinc-500">μ (RGB)</dt>
                    <dd className="text-zinc-200">{p.input.tensor.channel_mean.map((v) => fmt(v, 3)).join(", ")}</dd>
                    <dt className="text-zinc-500">σ (RGB)</dt>
                    <dd className="text-zinc-200">{p.input.tensor.channel_std.map((v) => fmt(v, 3)).join(", ")}</dd>
                    <dt className="text-zinc-500">min/max</dt>
                    <dd className="text-zinc-200">
                      {fmt(p.input.tensor.min, 3)} / {fmt(p.input.tensor.max, 3)}
                    </dd>
                    <dt className="text-zinc-500">transforms</dt>
                    <dd className="text-zinc-300">{p.input.transforms.join(" → ")}</dd>
                  </dl>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </LabCard>
  );
}
