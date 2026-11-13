"use client";

import { useState } from "react";
import { useEngineState } from "@/hooks/useEngine";
import { ChatAssistant } from "@/components/ChatAssistant/ChatAssistant";
import { Badge, Empty, LabCard, statusTone } from "@/components/ui";
import { fmt, humanize } from "@/lib/format";

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-800 bg-black/60 p-1.5 font-mono text-[10px] leading-snug text-zinc-300">{JSON.stringify(value, null, 2)}</pre>;
}

export function LLMTracePanel() {
  const { latestResult, chat } = useEngineState();
  const [tab, setTab] = useState<"evidence" | "trace" | "context" | "chat">("evidence");
  const res = chat.lastResponse;
  const tr = res?.trace;
  const tabs = [
    ["evidence", "Live evidence"],
    ["trace", "Agent trace"],
    ["context", "Context sent"],
    ["chat", "Chat"],
  ] as const;
  return (
    <LabCard
      id="p6"
      title="P6 · LLM context & agent trace"
      subtitle="Observable inputs/outputs only — no hidden reasoning, credentials or provider internals"
      actions={
        <div role="tablist" className="flex gap-1">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`rounded px-1.5 py-0.5 text-[10px] ${tab === k ? "bg-violet-900/70 text-violet-100" : "text-zinc-400 hover:text-zinc-100"}`}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      {tab === "evidence" && (
        <div className="space-y-2">
          <p className="text-[10px] text-zinc-500">StructuredObservations aggregated by the server for this session. This — not raw pixels — is what the assistant may use.</p>
          {latestResult ? <Json value={{ ...latestResult.observations, user_reported_symptoms: chat.symptoms }} /> : <Empty>No observations yet.</Empty>}
        </div>
      )}
      {tab === "trace" &&
        (tr ? (
          <div className="space-y-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="info">{tr.provider}</Badge>
              <Badge tone="neutral">{tr.model}</Badge>
              <Badge tone={tr.route === "standard" ? "ok" : tr.route === "urgent_safety" ? "error" : "warn"}>route: {tr.route}</Badge>
              <span className="font-mono text-[10px] text-zinc-400">
                {fmt(tr.latency_ms)} ms · attempts {tr.attempts}
                {Object.keys(tr.usage).length ? ` · ${Object.entries(tr.usage).map(([k, v]) => `${k}=${v}`).join(" ")}` : " · token usage n/a"}
              </span>
            </div>
            <div>
              <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-500">Workflow steps</div>
              <ol className="space-y-0.5">
                {tr.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 font-mono text-[10px]">
                    <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    <span className="text-zinc-200">{humanize(s.name)}</span>
                    <span className="text-zinc-500">{fmt(s.duration_ms, 1)} ms</span>
                    {Object.keys(s.detail).length > 0 && <span className="truncate text-zinc-500" title={JSON.stringify(s.detail)}>{JSON.stringify(s.detail)}</span>}
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-500">Selected evidence</div>
                {tr.selected_evidence.length ? (
                  <ul className="font-mono text-[10px] text-zinc-300">
                    {tr.selected_evidence.map((e) => (
                      <li key={e}>• {e}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10px] text-zinc-500">none</p>
                )}
                <div className="mb-0.5 mt-2 text-[9px] uppercase tracking-wider text-zinc-500">Retrieval</div>
                {tr.retrieval.length ? (
                  <ul className="text-[10px] text-zinc-300">
                    {tr.retrieval.map((d) => (
                      <li key={d.doc_id}>
                        <span className="font-mono text-zinc-500">{d.doc_id}</span> {d.title} <span className="text-zinc-500">({fmt(d.score, 2)}, {d.review_status})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10px] text-zinc-500">no documents retrieved</p>
                )}
              </div>
              <div>
                <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-500">Response validation</div>
                <ul className="space-y-0.5">
                  {tr.validation.map((c) => (
                    <li key={c.name} className="flex items-start gap-1 text-[10px]">
                      <span className={c.passed ? "text-emerald-400" : "text-rose-400"}>{c.passed ? "✓" : "✗"}</span>
                      <span className="font-mono text-zinc-300">{c.name}</span>
                      {c.detail && <span className="text-zinc-500">— {c.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div>
              <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-500">Final validated answer</div>
              <Json value={res.reply} />
            </div>
          </div>
        ) : (
          <Empty>Send a chat message to see the agent trace.</Empty>
        ))}
      {tab === "context" &&
        (tr ? (
          <div className="space-y-2">
            <p className="text-[10px] text-zinc-500">Redacted preview of the context the server assembled for the LLM.</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-black/60 p-1.5 font-mono text-[10px] text-zinc-300">{tr.context_preview}</pre>
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">Evidence snapshot used</div>
            <Json value={tr.evidence} />
          </div>
        ) : (
          <Empty>No LLM request yet.</Empty>
        ))}
      {tab === "chat" && (
        <div className="h-full min-h-48">
          <ChatAssistant variant="dark" compact />
        </div>
      )}
    </LabCard>
  );
}
