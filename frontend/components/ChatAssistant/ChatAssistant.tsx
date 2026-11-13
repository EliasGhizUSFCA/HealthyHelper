"use client";

import { MiniProductCard } from "@/components/Beauty/MiniProductCard";

import { useEffect, useRef, useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";
import { cx } from "@/components/ui";

const ROUTE_LABEL: Record<string, string> = {
  urgent_safety: "Safety notice",
  diagnosis_request: "About diagnosis",
  insufficient_evidence: "Not enough visual information",
  fallback: "Fallback reply",
};

export function ChatAssistant({ variant = "light", compact = false }: { variant?: "light" | "dark"; compact?: boolean }) {
  const engine = useEngine();
  const { chat } = useEngineState();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const dark = variant === "dark";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages.length, chat.pending]);

  const send = (t: string) => {
    void engine.sendChat(t);
    setText("");
  };

  return (
    <div className={cx("flex h-full min-h-0 flex-col", dark ? "text-zinc-200" : "text-slate-800")}>
      <div ref={listRef} role="log" aria-live="polite" aria-label="Conversation with the assistant" className={cx("min-h-0 flex-1 space-y-3 overflow-y-auto", compact ? "text-xs" : "text-base")}>
        {chat.messages.length === 0 && (
          <p className={cx(dark ? "text-zinc-500" : "text-slate-500", compact ? "text-xs" : "text-sm")}>
            Ask about what the mirror can see, e.g. &ldquo;What do you notice about my lips?&rdquo; The assistant only uses validated observations and what you tell it.
          </p>
        )}
        {chat.messages.map((m, i) => {
          const meta = chat.replyMeta[i];
          const urgent = meta?.route === "urgent_safety";
          return (
            <div key={i} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cx(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 leading-relaxed",
                  m.role === "user"
                    ? dark
                      ? "bg-cyan-900/60 text-cyan-50"
                      : "bg-sky-700 text-white"
                    : urgent
                      ? dark
                        ? "border-2 border-rose-500 bg-rose-950 text-rose-100"
                        : "border-2 border-rose-600 bg-rose-50 text-rose-950"
                      : dark
                        ? "bg-zinc-800 text-zinc-100"
                        : "border border-slate-200 bg-white",
                )}
              >
                {meta && ROUTE_LABEL[meta.route] && (
                  <div className={cx("mb-1 text-[11px] font-semibold uppercase tracking-wide", urgent ? "text-rose-600" : dark ? "text-amber-300" : "text-amber-700")}>
                    {urgent && "⚠ "}
                    {ROUTE_LABEL[meta.route]}
                  </div>
                )}
                <p className="whitespace-pre-wrap">{m.content}</p>
                {meta?.followUps?.length ? (
                  <ul aria-label="Follow-up questions" className={cx("mt-2 space-y-0.5 border-l-2 pl-2 text-[0.9em]", dark ? "border-zinc-600 text-zinc-300" : "border-sky-200 text-slate-600")}>
                    {meta.followUps.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                ) : null}
                {meta?.products?.length ? (
                  <div className="mt-2 space-y-1.5" aria-label="Suggested products">
                    {meta.products.map((r) => (
                      <MiniProductCard key={r.product.product_id} ranked={r} dark={dark} />
                    ))}
                  </div>
                ) : null}
                {meta && <div className={cx("mt-1 text-[10px]", dark ? "text-zinc-500" : "text-slate-400")}>{meta.provider}</div>}
              </div>
            </div>
          );
        })}
        {chat.pending && <p className={cx("text-sm", dark ? "text-zinc-500" : "text-slate-500")}>Assistant is thinking…</p>}
        {chat.error && (
          <p role="alert" className={cx("rounded px-2 py-1 text-sm", dark ? "bg-rose-950 text-rose-200" : "bg-rose-50 text-rose-800")}>
            {chat.error}
          </p>
        )}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label htmlFor={`chat-input-${variant}`} className="sr-only">
          Message the assistant
        </label>
        <input
          id={`chat-input-${variant}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder="Ask anything — or e.g. “recommend a fragrance-free lip balm”"
          className={cx(
            "min-w-0 flex-1 rounded-lg border px-3",
            compact ? "py-1 text-xs" : "py-2 text-base",
            dark ? "border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-600" : "border-slate-300 bg-white placeholder:text-slate-400",
          )}
        />
        <button
          type="submit"
          disabled={!text.trim() || chat.pending}
          className={cx("rounded-lg px-3 font-medium disabled:opacity-40", compact ? "text-xs" : "text-base", dark ? "bg-cyan-700 text-white" : "bg-sky-700 text-white")}
        >
          Send
        </button>
        {chat.messages.length > 0 && (
          <button type="button" onClick={() => engine.clearChat()} className={cx("rounded-lg border px-2", compact ? "text-xs" : "text-sm", dark ? "border-zinc-700 text-zinc-400" : "border-slate-300 text-slate-600")}>
            Clear
          </button>
        )}
      </form>
    </div>
  );
}
