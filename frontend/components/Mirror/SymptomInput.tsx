"use client";

import { useState } from "react";
import { useEngine, useEngineState } from "@/hooks/useEngine";

const COMMON = ["Dry or chapped lips", "Itchy or irritated eyes", "Dry, flaky skin", "Runny or sore nose", "Been in cold or dry weather", "Wearing contact lenses"];

export function SymptomInput() {
  const engine = useEngine();
  const { chat } = useEngineState();
  const [text, setText] = useState("");
  const toggle = (s: string) => engine.setSymptoms(chat.symptoms.includes(s) ? chat.symptoms.filter((x) => x !== s) : [...chat.symptoms, s]);
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700">Anything you&apos;ve noticed? (optional)</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {[...COMMON, ...chat.symptoms.filter((s) => !COMMON.includes(s))].map((s) => {
          const on = chat.symptoms.includes(s);
          return (
            <button key={s} type="button" aria-pressed={on} onClick={() => toggle(s)} className={`rounded-full border px-3 py-1 text-sm ${on ? "border-sky-700 bg-sky-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
              {s}
            </button>
          );
        })}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t && !chat.symptoms.includes(t)) engine.setSymptoms([...chat.symptoms, t.slice(0, 120)]);
          setText("");
        }}
      >
        <label htmlFor="symptom-free" className="sr-only">
          Describe something else
        </label>
        <input id="symptom-free" value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe something else…" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" maxLength={120} />
        <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 text-sm">
          Add
        </button>
      </form>
    </fieldset>
  );
}
